export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
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

  // CLAIM a batch atomically so two concurrent /send calls (eg. user
  // double-clicks Send, or two browser tabs) cannot grab the same rows and
  // double-charge / double-deliver.  We flip status queued -> sending first,
  // then SELECT the rows we just claimed.  Any other worker hitting the table
  // will see those rows as 'sending' (not 'queued') and skip them.
  const claimToken = crypto.randomUUID().replace(/-/g, "");
  await db.execute(
    `UPDATE campaign_recipients
        SET status = 'sent', tracking_token = COALESCE(tracking_token, ?)
      WHERE id IN (
        SELECT id FROM (
          SELECT id FROM campaign_recipients
           WHERE campaign_id = ? AND status = 'queued'
           ORDER BY id ASC
           LIMIT ${limit}
        ) AS pick
      )`,
    [claimToken, campaignId]
  );
  const [recipRows] = await db.execute(
    `SELECT id, email, tracking_token, message_id, status
       FROM campaign_recipients
      WHERE campaign_id = ? AND status = 'sent'
      LIMIT ${limit}`,
    [campaignId]
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
      await db.execute(
        "UPDATE campaign_recipients SET status='failed', last_event_at = NOW() WHERE id = ?",
        [r.id]
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
