export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { isStaff } from "@/lib/admin";
import { withTracking, htmlToText, unsubscribeUrl } from "@/lib/emailTracking";
import { sendEmail } from "@/lib/emailProvider";
import { loadSuppressionSet, isSuppressed } from "@/lib/suppressions";

export const runtime = "nodejs"; // ensure NOT edge

// Pricing v2: 1 credit buys 50 recipients.  If admin changes the per-batch
// rate in credits_prices we still treat the batch size as 50 here.  Tune in
// both places if you ever need to change it.
const EMAIL_BATCH_SIZE = 50;

type Body = {
  subject?: string;
  html?: string;
  fromEmail?: string;
  fromName?: string;
  limit?: number;
  dryRun?: boolean;
};

async function lookupPrice(feature: string, fallback: number): Promise<number> {
  const [rows] = await db.execute(
    "SELECT price FROM credits_prices WHERE feature = ? LIMIT 1",
    [feature]
  );
  const p = Number((rows as any[])[0]?.price);
  return Number.isFinite(p) && p >= 0 ? p : fallback;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { campaignId: string } }
) {
  // Auth + ownership check. This route previously had NO auth guard, so
  // any anonymous caller could POST /api/campaigns/<id>/send to trigger a
  // send (and drain credits) on any user's campaign. Now we require a
  // session and verify the caller either owns the campaign or is staff.
  const session = await getUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const campaignId = params.campaignId;
  const baseUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (!baseUrl) {
    return NextResponse.json({ error: "APP_URL not set" }, { status: 500 });
  }

  const body = (await req.json().catch(() => ({}))) as Body;
  const limit = Math.min(Math.max(body.limit ?? 200, 1), 1000);

  const [campRows] = await db.execute(
    "SELECT id, user_id, subject, html, from_email, status, admin_bypass FROM campaigns WHERE id = ? LIMIT 1",
    [campaignId]
  );
  const campaignRow = (campRows as any[])[0];
  if (!campaignRow) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  // IDOR guard — only the owning user or staff (admin/moderator) can send.
  // Without this, an attacker with a valid session can drain another
  // user's credits by guessing/enumerating campaign UUIDs.
  if (campaignRow.user_id !== session.id && !isStaff(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const isAdminBypass = !!Number(campaignRow.admin_bypass);

  // Already finished — don't re-charge or re-send.
  if (campaignRow.status === "sent") {
    return NextResponse.json({ ok: true, status: "sent", message: "Already sent" });
  }

  const subject = body.subject ?? campaignRow.subject;
  const baseHtml = body.html ?? campaignRow.html;
  const fromEmail =
    body.fromEmail ?? campaignRow.from_email ?? process.env.DEFAULT_FROM_EMAIL;
  const fromName = body.fromName ?? process.env.DEFAULT_FROM_NAME;

  if (!subject || !baseHtml || !fromEmail) {
    return NextResponse.json(
      { error: "Missing subject/html/fromEmail" },
      { status: 400 }
    );
  }

  await db.execute(
    "UPDATE campaigns SET status = 'sending', updated_at = NOW() WHERE id = ?",
    [campaignId]
  );

  // RECOVERY: revive any rows stuck in 'sent' state with NO message_id from
  // a previous batch that crashed mid-process.  Without this, those rows
  // would never be retried and the campaign would forever look stuck.
  // 'sent' + message_id NULL + older than 5 min = abandoned claim.
  await db.execute(
    `UPDATE campaign_recipients
        SET status = 'queued', last_event_at = NOW()
      WHERE campaign_id = ?
        AND status = 'sent'
        AND message_id IS NULL
        AND (last_event_at IS NULL OR last_event_at < (NOW() - INTERVAL 5 MINUTE))`,
    [campaignId]
  );

  // CLAIM a batch atomically using SELECT...FOR UPDATE inside a transaction.
  // Two parallel /send calls can't grab the same rows: the second blocks
  // until the first's transaction commits, then sees the rows as 'sent'.
  // We return the EXACT list of claimed ids so the SELECT below filters
  // precisely (not just "status='sent'" which would pick up other batches).
  const conn = await db.getConnection();
  let claimedIds: string[] = [];
  try {
    await conn.beginTransaction();
    const [pickRows] = await conn.execute(
      `SELECT id FROM campaign_recipients
        WHERE campaign_id = ? AND status = 'queued'
        ORDER BY id ASC
        LIMIT ${limit}
        FOR UPDATE`,
      [campaignId]
    );
    claimedIds = (pickRows as any[]).map((r) => r.id as string);
    if (claimedIds.length > 0) {
      const ph = claimedIds.map(() => "?").join(",");
      await conn.execute(
        `UPDATE campaign_recipients
            SET status = 'sent', last_event_at = NOW()
          WHERE id IN (${ph})`,
        claimedIds
      );
    }
    await conn.commit();
  } catch (e: any) {
    await conn.rollback();
    return NextResponse.json(
      { error: e?.message || "Claim failed" },
      { status: 500 }
    );
  } finally {
    conn.release();
  }

  if (claimedIds.length === 0) {
    // Nothing left to send — likely a duplicate /send call after the queue drained.
    return NextResponse.json({ ok: true, sent: 0, failed: 0, skipped: 0, errors: [] });
  }

  const idPlaceholders = claimedIds.map(() => "?").join(",");
  const [recipRows] = await db.execute(
    `SELECT id, email, tracking_token, message_id, status
       FROM campaign_recipients
      WHERE id IN (${idPlaceholders})`,
    claimedIds
  );
  const recips = recipRows as any[];

  // -------------------------------------------------------------------------
  // CREDIT PRE-FLIGHT (pricing v2: 1 credit per EMAIL_BATCH_SIZE recipients).
  // We charge ONCE before the loop, not per-recipient.  If insufficient we
  // abort with 402 — no SES calls were made, no rows touched.  The deduction
  // is reflected in credits_wallets + credits_ledger via spend_credit().
  // -------------------------------------------------------------------------
  let creditsCharged = 0;
  if (recips.length > 0 && !body.dryRun && !isAdminBypass) {
    const ratePerBatch = await lookupPrice("email_send_batch", 1);
    const batches = Math.ceil(recips.length / EMAIL_BATCH_SIZE);
    const cost = batches * ratePerBatch;

    try {
      await db.query("CALL spend_credit(?, ?, ?, ?, ?)", [
        campaignRow.user_id,
        cost,
        "debit",
        `email_send:${campaignId}`,
        `Send campaign · ${recips.length} recipients`,
      ]);
      creditsCharged = cost;
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg.includes("insufficient_credits")) {
        // Roll the campaign back to draft so the user can retry after topping up.
        await db.execute(
          "UPDATE campaigns SET status = 'draft', updated_at = NOW() WHERE id = ?",
          [campaignId]
        );
        return NextResponse.json(
          {
            error: "INSUFFICIENT_CREDITS",
            required: cost,
            recipients: recips.length,
            batch_size: EMAIL_BATCH_SIZE,
            rate_per_batch: ratePerBatch,
          },
          { status: 402 }
        );
      }
      // Don't bury other DB errors
      return NextResponse.json(
        { error: msg || "Credit charge failed" },
        { status: 500 }
      );
    }
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const errors: Array<{ id: string; email: string; error: string }> = [];

  // Re-load suppressions at SEND time, not just at campaign-create time.
  // Without this, a user who suppresses an address mid-drain still receives
  // queued mail.  Cheap query: one SELECT scoped to the campaign owner.
  const suppressionSet = await loadSuppressionSet(campaignRow.user_id);

  for (const r of recips) {
    // Late-suppression check: address was OK when the campaign was created
    // but the user has added it to suppressions since.  Skip + record.
    if (isSuppressed(r.email, suppressionSet)) {
      await db.execute(
        "UPDATE campaign_recipients SET status='suppressed', last_event_at = NOW() WHERE id = ?",
        [r.id]
      );
      skipped++;
      continue;
    }

    const token = r.tracking_token || crypto.randomUUID();
    if (!r.tracking_token) {
      await db.execute(
        "UPDATE campaign_recipients SET tracking_token = ? WHERE id = ?",
        [token, r.id]
      );
    }

    const html = withTracking(baseHtml, campaignId, token, baseUrl);

    if (body.dryRun) {
      skipped++;
      continue;
    }

    try {
      const resp = await sendEmail({
        to: r.email,
        subject,
        html,
        fromEmail,
        fromName,
        text: htmlToText(html),
        unsubscribeUrl: unsubscribeUrl(token, baseUrl),
        campaignId,
      });
      await db.execute(
        `UPDATE campaign_recipients
            SET message_id = ?, status = 'delivered', last_event_at = NOW()
          WHERE id = ?`,
        [resp.id, r.id]
      );
      sent++;
      await sleep(40);
    } catch (e: any) {
      failed++;
      const msg = e?.message ?? String(e);
      errors.push({ id: r.id, email: r.email, error: msg });
      // Persist the actual error so the tracking page can show users WHY a
      // send failed (auth issue, mailbox rejected, SES throttled, etc.).
      // Truncated to 500 chars to match the column width.
      await db.execute(
        "UPDATE campaign_recipients SET status='failed', error_reason=?, last_event_at = NOW() WHERE id = ?",
        [String(msg).slice(0, 500), r.id]
      );
    }
  }

  // Decide the final campaign status from real DB state.
  const [remRows] = await db.execute(
    `SELECT
        SUM(CASE WHEN status = 'queued'    THEN 1 ELSE 0 END) AS remaining_queued,
        SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) AS delivered_count,
        SUM(CASE WHEN status = 'failed'    THEN 1 ELSE 0 END) AS failed_count
       FROM campaign_recipients
      WHERE campaign_id = ?`,
    [campaignId]
  );
  const s = (remRows as any[])[0] || {};
  const remainingQueued = Number(s.remaining_queued || 0);
  const deliveredCount = Number(s.delivered_count || 0);
  const failedCount = Number(s.failed_count || 0);

  let finalStatus: "sent" | "failed" | "sending" = "sending";
  if (remainingQueued === 0) {
    finalStatus =
      deliveredCount > 0 ? "sent" : failedCount > 0 ? "failed" : "sent";
  }

  await db.execute(
    `UPDATE campaigns
        SET status = ?,
            credits_charged = credits_charged + ?,
            updated_at = NOW()
      WHERE id = ?`,
    [finalStatus, creditsCharged, campaignId]
  );

  return NextResponse.json({
    ok: true,
    sent,
    skipped,
    failed,
    status: finalStatus,
    delivered: deliveredCount,
    remaining_queued: remainingQueued,
    credits_charged: creditsCharged,
    errors,
  });
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}
