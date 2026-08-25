import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { isStaff } from "@/lib/admin";
import { loadSuppressionSet, isSuppressed } from "@/lib/suppressions";
import {
  multiFilter,
  pushInClause,
  normalizeUploadedEmails,
  companyInboxes,
  companyInboxesByFilter,
} from "@/lib/audience";
import { getApprovedCompanyIds } from "@/lib/memberships";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_STATUSES = new Set(["draft", "scheduled", "sending"]);

export async function GET() {
  const session = await getUser();
  if (!session) return NextResponse.json({ campaigns: [] }, { status: 401 });

  const [rows] = await db.execute(
    `SELECT id, name, status, created_at, recipients_count, credits_charged, low_signal
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
 *       mode: 'all' | 'filtered' | 'selected' | 'uploaded' | 'admin_all'
 *           | 'company_inboxes',
 *       q?: string,             // when mode === 'filtered', server applies it
 *       contact_ids?: string[], // when mode === 'selected'
 *       emails?: string[],      // when mode === 'uploaded' (one-off list)
 *       segments?: string[], countries?: string[], company_ids?: string[],
 *       company_types?: string[]
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
  // Friendly From name chosen from the "Send from" picker.  Recorded on the
  // campaign so the send route can build a "Name" <email> From header.
  const from_name = body.from_name ? String(body.from_name).trim().slice(0, 255) : null;
  const status = String(body.status || "draft");
  // "Reduce promotional signals" — omit tracking pixel/link-redirects + bulk
  // headers on send to aim for Gmail's Primary tab (loses open/click stats).
  const lowSignal = body.low_signal === true;

  // Audience resolution.  Admin-bypass mode `admin_all` is only honored for
  // staff (admin/moderator) — it sends to *every* contact regardless of
  // unlock state AND skips the credit charge.
  const audience = body.audience && typeof body.audience === "object" ? body.audience : {};
  let mode = String(audience.mode || "all").toLowerCase();
  const callerIsStaff = isStaff(session.role);
  if (mode === "admin_all" && !callerIsStaff) mode = "all"; // silently downgrade non-staff
  if (!["all", "filtered", "selected", "admin_all", "uploaded", "company_inboxes"].includes(mode))
    mode = "all";
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
  // All three are multi-select: `segments`/`countries` (arrays) are preferred,
  // with the legacy singular keys still honored for older callers.
  const filterSegments  = multiFilter(audience.segments,  audience.segment);
  const filterCountries = multiFilter(audience.countries, audience.country);
  const filterCompanyTypes = multiFilter(audience.company_types, audience.company_type);
  // Department targeting (e.g. "LBI") — narrows to contacts whose `department`
  // column matches. Used by the Catalogues & Offers send flow.
  const filterDepartment = String(audience.department || "").trim();
  // Leads-only audience — set ONLY by the Catalogues & Offers send flow, which
  // targets 'lead' contacts. Regular campaigns leave it off and reach every
  // contact, exactly as before this feature.
  const leadsOnly = audience.leads_only === true;
  const leadClause = leadsOnly ? "AND c.contact_type = 'lead'" : "";
  // company_ids (array, new) takes priority; company_id (single, legacy) is
  // still honored for any caller that hasn't migrated yet.
  const filterCompanyIds = multiFilter(audience.company_ids, audience.company_id);
  // One-off recipient list pasted/uploaded on the compose page. Re-validated
  // server-side — the client can post anything here.
  const uploadedEmails = mode === "uploaded" ? normalizeUploadedEmails(audience.emails) : [];
  // Also mail each company's general inbox, not just the named contacts.
  const includeCompanyEmails = audience.include_company_emails === true;
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
  // `id` is the contact id, or null for uploaded addresses with no contact row
  // (campaign_recipients.contact_id is nullable for exactly this case).
  let recipients: Array<{ id: string | null; email: string; company_id?: string | null }> = [];

  if (mode === "selected") {
    if (!explicitIds.length) {
      if (status === "sending") {
        return NextResponse.json({ error: "No recipients selected" }, { status: 400 });
      }
    } else {
      const ph = explicitIds.map(() => "?").join(",");
      // leadClause is empty for regular sends and 'AND c.contact_type = \'lead\''
      // for catalogue/offer sends.
      const sql = callerIsStaff
        ? `SELECT DISTINCT c.id, c.email, c.company_id
             FROM contacts c
            WHERE c.id IN (${ph})
              ${leadClause}
              AND c.email IS NOT NULL AND c.email <> ''`
        : `SELECT DISTINCT c.id, c.email, c.company_id
             FROM contacts c
             JOIN unlocked_contacts_v u
               ON u.contact_id = c.id AND u.user_id = ?
            WHERE c.id IN (${ph})
              ${leadClause}
              AND c.email IS NOT NULL AND c.email <> ''`;
      const params = callerIsStaff ? explicitIds : [session.id, ...explicitIds];
      const [rows] = await db.query(sql, params);
      recipients = (rows as any[]).map((r) => ({ id: r.id, email: r.email, company_id: r.company_id }));
    }
  } else if (mode === "uploaded") {
    // One-off list uploaded on the compose page. These addresses deliberately
    // do NOT have to exist in `contacts` — that's the whole point of the mode —
    // so contact_id stays NULL for anything we can't match.
    if (!uploadedEmails.length) {
      if (status === "sending") {
        return NextResponse.json({ error: "The uploaded list has no valid email addresses" }, { status: 400 });
      }
    } else {
      // Best-effort match back to existing contacts so the tracking page can
      // show a name instead of a bare address. Chunked because a 10k-element
      // IN list is far past what MySQL will plan well.
      const byEmail = new Map<string, string>();
      const CHUNK = 500;
      for (let i = 0; i < uploadedEmails.length; i += CHUNK) {
        const slice = uploadedEmails.slice(i, i + CHUNK);
        const [rows] = await db.query(
          `SELECT id, LOWER(email) AS email
             FROM contacts
            WHERE LOWER(email) IN (${slice.map(() => "?").join(",")})`,
          slice
        );
        for (const r of rows as any[]) {
          if (!byEmail.has(r.email)) byEmail.set(r.email, r.id);
        }
      }
      recipients = uploadedEmails.map((email) => ({ id: byEmail.get(email) ?? null, email }));
    }
  } else if (mode === "company_inboxes") {
    // Companies, not people. The addresses come off the company record itself,
    // so a company with no contacts — most of an imported list — is reachable
    // here and nowhere else. contact_id stays NULL: nobody is being written to.
    const emails = await companyInboxesByFilter({
      userId: session.id,
      isStaff: callerIsStaff,
      approvedCompanyIds: callerIsStaff ? [] : await getApprovedCompanyIds(session.id),
      segments: filterSegments,
      countries: filterCountries,
      companyTypes: filterCompanyTypes,
      companyIds: filterCompanyIds,
      q: search,
    });
    if (!emails.length && status === "sending") {
      return NextResponse.json(
        { error: "No company email addresses match those filters" },
        { status: 400 }
      );
    }
    recipients = emails.map((email) => ({ id: null, email }));
  } else if (isAdminBypass) {
    // Explicit admin compose: send to EVERY contact with a valid email
    // (restricted to leads only when the send is a catalogue/offer).
    const [rows] = await db.query(
      `SELECT id, email, company_id FROM contacts
        WHERE email IS NOT NULL AND email <> ''
          ${leadsOnly ? "AND contact_type = 'lead'" : ""}`
    );
    recipients = (rows as any[]).map((r) => ({ id: r.id, email: r.email, company_id: r.company_id }));
  } else {
    // 'all' or 'filtered'.  Regular user: scoped to their unlocked_contacts_v.
    // Staff: scoped to ALL contacts (no unlock join).
    // Structured filters (segment/country/company_id) JOIN companies on demand.
    const where: string[] = ["c.email IS NOT NULL", "c.email <> ''"];
    if (leadsOnly) where.push("c.contact_type = 'lead'");
    const params: any[] = [];
    if (!callerIsStaff) {
      where.unshift("u.user_id = ?");
      params.push(session.id);
    }
    if (mode === "filtered" && search) {
      where.push("(LOWER(c.contact_name) LIKE ? OR LOWER(c.email) LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }
    pushInClause(where, params, "c.company_id", filterCompanyIds);
    pushInClause(where, params, "co.segment", filterSegments);
    pushInClause(where, params, "co.country", filterCountries);
    // industry and company_type are written together by the importer but the
    // Add Company form fills only industry — COALESCE matches either.
    pushInClause(where, params, "COALESCE(co.industry, co.company_type)", filterCompanyTypes);
    if (filterDepartment) { where.push("c.department = ?"); params.push(filterDepartment); }

    const fromParts: string[] = ["contacts c"];
    if (!callerIsStaff) fromParts.push("JOIN unlocked_contacts_v u ON u.contact_id = c.id");
    if (filterSegments.length || filterCountries.length || filterCompanyTypes.length) {
      fromParts.push("LEFT JOIN companies co ON co.company_id = c.company_id");
    }
    const [rows] = await db.query(
      `SELECT DISTINCT c.id, c.email, c.company_id
         FROM ${fromParts.join(" ")}
        WHERE ${where.join(" AND ")}`,
      params
    );
    recipients = (rows as any[]).map((r) => ({ id: r.id, email: r.email, company_id: r.company_id }));
  }

  // Append the general inboxes of every company represented in the audience.
  // contact_id stays NULL — these are company addresses, not people.
  if (includeCompanyEmails && recipients.length && mode !== "company_inboxes") {
    const inboxes = await companyInboxes(
      recipients.map((r) => r.company_id).filter(Boolean) as string[]
    );
    for (const email of inboxes) recipients.push({ id: null, email });
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
         (id, user_id, name, subject, html, from_email, from_name, status, recipients_count, credits_charged, admin_bypass, low_signal)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      // recipients_count is the SENDABLE count, not the suppressed total —
      // that's what the campaign metrics + credit-cost calculations should see.
      [id, session.id, name, subject, html, from_email, from_name, status, sendableCount, skipCreditCharge ? 1 : 0, lowSignal ? 1 : 0]
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
