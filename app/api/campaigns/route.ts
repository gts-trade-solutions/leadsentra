import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { isStaff } from "@/lib/admin";
import { loadSuppressionSet, isSuppressed } from "@/lib/suppressions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_STATUSES = new Set(["draft", "scheduled", "sending"]);

export async function GET() {
  const session = await getUser();
  if (!session) return NextResponse.json({ campaigns: [] }, { status: 401 });

  const [rows] = await db.execute(
    `SELECT id, name, status, created_at, recipients_count, credits_charged
       FROM campaigns
      WHERE user_id = ?
      ORDER BY created_at DESC`,
    [session.id]
  );
  return NextResponse.json({ campaigns: rows });
}

/**
 * Create a campaign.  Body:
 *   {
 *     name, subject, html, from_email,
 *     status?: 'draft' | 'scheduled' | 'sending',
 *     scheduled_at?: ISO string,
 *     audience: {
 *       mode: 'all' | 'filtered' | 'selected',
 *       q?: string,            // when mode === 'filtered', server applies it
 *       contact_ids?: string[] // when mode === 'selected'
 *     }
 *   }
 *
 * The server resolves the recipient set itself so the client doesn't have
 * to ship thousands of contact ids for "all unlocked" / large filtered sends.
 */
export async function POST(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  const subject = body.subject ? String(body.subject).trim() : null;
  const html = body.html ? String(body.html) : null;
  const from_email = body.from_email ? String(body.from_email).trim() : null;
  const status = String(body.status || "draft");

  // Audience resolution.  Admin-bypass mode `admin_all` is only honored for
  // staff (admin/moderator) — it sends to *every* contact regardless of
  // unlock state AND skips the credit charge.
  const audience = body.audience && typeof body.audience === "object" ? body.audience : {};
  let mode = String(audience.mode || "all").toLowerCase();
  const callerIsStaff = isStaff(session.role);
  if (mode === "admin_all" && !callerIsStaff) mode = "all"; // silently downgrade non-staff
  if (!["all", "filtered", "selected", "admin_all"].includes(mode)) mode = "all";
  // Audience-side bypass: `admin_all` mode resolves to EVERY contact (ignores unlocks).
  const isAdminAudience = mode === "admin_all";
  // Credit-side bypass: any staff caller (admin OR moderator) sends for free,
  // regardless of audience mode.  Persisted into campaigns.admin_bypass so the
  // /send route also skips its credit charge.
  const skipCreditCharge = isAdminAudience || callerIsStaff;
  // Kept for the audience-resolution branch below (only the explicit admin_all mode).
  const isAdminBypass = isAdminAudience;
  const search = String(audience.q || "").trim().toLowerCase();
  // Structured audience filters (parallel to the audience picker's
  // segment/country/company dropdowns).  Applied to 'all' and 'filtered' modes.
  const filterSegment   = String(audience.segment   || "").trim();
  const filterCountry   = String(audience.country   || "").trim();
  const filterCompanyId = String(audience.company_id || "").trim();
  const hasStructured   = !!(filterSegment || filterCountry || filterCompanyId);
  const explicitIds: string[] = Array.isArray(audience.contact_ids)
    ? audience.contact_ids.filter((x: any) => typeof x === "string" && x)
    : Array.isArray(body.contact_ids) // backwards-compat shim
    ? body.contact_ids.filter((x: any) => typeof x === "string" && x)
    : [];

  const scheduled_at = body.scheduled_at ? new Date(body.scheduled_at) : null;

  if (!name) return NextResponse.json({ error: "Campaign name is required" }, { status: 400 });
  if (!ALLOWED_STATUSES.has(status)) {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }
  if (status === "scheduled" && (!scheduled_at || isNaN(scheduled_at.getTime()))) {
    return NextResponse.json({ error: "scheduled_at is required when status='scheduled'" }, { status: 400 });
  }
  if (status === "sending" && (!subject || !html || !from_email)) {
    return NextResponse.json({ error: "Subject, body, and from_email are required to send" }, { status: 400 });
  }

  // ---- Server-side audience resolution -------------------------------------
  // For staff (admin/moderator), the unlock requirement is dropped from every
  // audience mode — they can mail any contact in the DB.  For regular users
  // we keep the join with unlocked_contacts_v.
  let recipients: Array<{ id: string; email: string }> = [];

  if (mode === "selected") {
    if (!explicitIds.length) {
      if (status === "sending") {
        return NextResponse.json({ error: "No recipients selected" }, { status: 400 });
      }
    } else {
      const ph = explicitIds.map(() => "?").join(",");
      const sql = callerIsStaff
        ? `SELECT DISTINCT c.id, c.email
             FROM contacts c
            WHERE c.id IN (${ph})
              AND c.email IS NOT NULL AND c.email <> ''`
        : `SELECT DISTINCT c.id, c.email
             FROM contacts c
             JOIN unlocked_contacts_v u
               ON u.contact_id = c.id AND u.user_id = ?
            WHERE c.id IN (${ph})
              AND c.email IS NOT NULL AND c.email <> ''`;
      const params = callerIsStaff ? explicitIds : [session.id, ...explicitIds];
      const [rows] = await db.query(sql, params);
      recipients = (rows as any[]).map((r) => ({ id: r.id, email: r.email }));
    }
  } else if (isAdminBypass) {
    // Explicit admin compose: send to EVERY contact with a valid email.
    const [rows] = await db.query(
      `SELECT id, email FROM contacts
        WHERE email IS NOT NULL AND email <> ''`
    );
    recipients = (rows as any[]).map((r) => ({ id: r.id, email: r.email }));
  } else {
    // 'all' or 'filtered'.  Regular user: scoped to their unlocked_contacts_v.
    // Staff: scoped to ALL contacts (no unlock join).
    // Structured filters (segment/country/company_id) JOIN companies on demand.
    const where: string[] = ["c.email IS NOT NULL", "c.email <> ''"];
    const params: any[] = [];
    if (!callerIsStaff) {
      where.unshift("u.user_id = ?");
      params.push(session.id);
    }
    if (mode === "filtered" && search) {
      where.push("(LOWER(c.contact_name) LIKE ? OR LOWER(c.email) LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }
    if (filterCompanyId) { where.push("c.company_id = ?"); params.push(filterCompanyId); }
    if (filterSegment)   { where.push("co.segment = ?");    params.push(filterSegment); }
    if (filterCountry)   { where.push("co.country = ?");    params.push(filterCountry); }

    const fromParts: string[] = ["contacts c"];
    if (!callerIsStaff) fromParts.push("JOIN unlocked_contacts_v u ON u.contact_id = c.id");
    if (filterSegment || filterCountry) {
      fromParts.push("LEFT JOIN companies co ON co.company_id = c.company_id");
    }
    const [rows] = await db.query(
      `SELECT DISTINCT c.id, c.email
         FROM ${fromParts.join(" ")}
        WHERE ${where.join(" AND ")}`,
      params
    );
    recipients = (rows as any[]).map((r) => ({ id: r.id, email: r.email }));
  }

  // Deduplicate by lowercase email so the same address only gets one
  // campaign_recipients row (and one SES send) even when multiple contacts
  // share the same email.  Keep the FIRST id we saw for each email.
  {
    const seen = new Set<string>();
    const deduped: typeof recipients = [];
    for (const r of recipients) {
      const key = String(r.email || "").trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      deduped.push({ ...r, email: key });
    }
    recipients = deduped;
  }

  if (status === "sending" && recipients.length === 0) {
    return NextResponse.json({ error: "No recipients selected" }, { status: 400 });
  }

  // ---- Suppression filtering -----------------------------------------------
  // Load the user's suppression list once, then partition recipients into
  // those that will actually be sent ("queued") vs. those we record but skip
  // ("suppressed").  The send route only processes status='queued', so
  // suppressed rows never hit SES — and we don't charge credits for them.
  const suppressionSet = await loadSuppressionSet(session.id);
  const partitioned = recipients.map((r) => ({
    ...r,
    suppressed: isSuppressed(r.email, suppressionSet),
  }));
  const sendableCount = partitioned.filter((r) => !r.suppressed).length;
  const suppressedCount = partitioned.length - sendableCount;
  // --------------------------------------------------------------------------

  // ---- Credit pre-flight (only when sending now) ---------------------------
  // Pricing v2: 1 credit per 50 recipients (batch).  We don't deduct here —
  // /api/campaigns/[id]/send does the actual spend_credit() call.  This
  // pre-flight just gives the UI a clean 402 with cost+balance so it can
  // show "you need X more credits" before opening the SEND confirmation.
  // Skipped entirely for admin-bypass sends (no credit charging at all).
  const EMAIL_BATCH_SIZE = 50;
  if (status === "sending" && sendableCount > 0 && !skipCreditCharge) {
    const [[priceRow]] = await db.query(
      "SELECT price FROM credits_prices WHERE feature = 'email_send_batch'"
    ) as any;
    const ratePerBatch = Number(priceRow?.price ?? 1);
    const batches = Math.ceil(sendableCount / EMAIL_BATCH_SIZE);
    const required = batches * ratePerBatch;

    const [[walletRow]] = await db.query(
      "SELECT balance FROM credits_wallets WHERE user_id = ?",
      [session.id]
    ) as any;
    const balance = Number(walletRow?.balance ?? 0);

    if (balance < required) {
      return NextResponse.json(
        {
          error: "INSUFFICIENT_CREDITS",
          required,
          balance,
          recipients: sendableCount,
          batch_size: EMAIL_BATCH_SIZE,
          rate_per_batch: ratePerBatch,
        },
        { status: 402 }
      );
    }
  }
  // --------------------------------------------------------------------------

  const id = randomUUID();
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    await conn.execute(
      `INSERT INTO campaigns
         (id, user_id, name, subject, html, from_email, status, recipients_count, credits_charged, admin_bypass)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      // recipients_count is the SENDABLE count, not the suppressed total —
      // that's what the campaign metrics + credit-cost calculations should see.
      [id, session.id, name, subject, html, from_email, status, sendableCount, skipCreditCharge ? 1 : 0]
    );

    if (partitioned.length) {
      // Insert in batches of 200 to keep statements small.
      // Suppressed recipients get status='suppressed' so they remain visible
      // in the tracking modal but are skipped by the send loop.
      const batchSize = 200;
      for (let i = 0; i < partitioned.length; i += batchSize) {
        const slice = partitioned.slice(i, i + batchSize);
        const values: any[] = [];
        const placeholders: string[] = [];
        for (const r of slice) {
          const rid = randomUUID();
          const tok = randomUUID().replace(/-/g, "");
          placeholders.push("(?, ?, ?, ?, ?, ?, ?)");
          values.push(
            rid,
            id,
            session.id,
            r.id,
            r.email,
            tok,
            r.suppressed ? "suppressed" : "queued"
          );
        }
        await conn.query(
          `INSERT INTO campaign_recipients
             (id, campaign_id, user_id, contact_id, email, tracking_token, status)
           VALUES ${placeholders.join(",")}`,
          values
        );
      }
    }

    await conn.commit();
  } catch (e: any) {
    await conn.rollback();
    return NextResponse.json({ error: e?.message || "Create failed" }, { status: 500 });
  } finally {
    conn.release();
  }

  // 'sending' status triggers an immediate send in /api/campaigns/[id]/send.
  // We don't auto-call it here — the UI does, because that path streams the SES result.
  return NextResponse.json(
    {
      id,
      status,
      recipients_count: sendableCount,
      suppressed_count: suppressedCount,
    },
    { status: 201 }
  );
}
