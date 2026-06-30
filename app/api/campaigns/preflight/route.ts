import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { isStaff } from "@/lib/admin";
import { loadSuppressionSet, isSuppressed } from "@/lib/suppressions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/campaigns/preflight
 *
 * Same audience-resolution logic as POST /api/campaigns but does NOT write
 * anything.  Returns the count of recipients that WOULD send vs WOULD be
 * skipped because they're already in the user's suppression list.
 *
 * Used by the compose page to show the user, before they click Send:
 *   "Will send to 4,123  ·  91 already suppressed (skipped)"
 *
 * Body shape mirrors the audience portion of POST /api/campaigns:
 *   { mode: 'all' | 'filtered' | 'selected' | 'admin_all',
 *     q?: string, contact_ids?: string[] }
 */
export async function POST(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const audience = body?.audience && typeof body.audience === "object" ? body.audience : body;
  const callerIsStaff = isStaff(session.role);
  let mode = String(audience?.mode || "all").toLowerCase();
  if (mode === "admin_all" && !callerIsStaff) mode = "all";
  if (!["all", "filtered", "selected", "admin_all"].includes(mode)) mode = "all";
  const search = String(audience?.q || "").trim().toLowerCase();
  const filterSegment    = String(audience?.segment    || "").trim();
  const filterCountry    = String(audience?.country    || "").trim();
  const filterDepartment = String(audience?.department || "").trim();
  // company_ids (array, new) takes priority; company_id (single, legacy) is
  // still honored for backwards compatibility with existing callers.
  const filterCompanyIds: string[] = Array.isArray(audience?.company_ids)
    ? audience.company_ids.filter((x: any) => typeof x === "string" && x.trim()).map((x: string) => x.trim())
    : audience?.company_id
      ? [String(audience.company_id).trim()].filter(Boolean)
      : [];
  const explicitIds: string[] = Array.isArray(audience?.contact_ids)
    ? audience.contact_ids.filter((x: any) => typeof x === "string" && x)
    : [];

  // Resolve recipient set — same SQL as POST /api/campaigns.
  let recipients: Array<{ email: string }> = [];
  if (mode === "selected") {
    if (!explicitIds.length) {
      return NextResponse.json({ total: 0, willSend: 0, suppressed: 0, suppressedEmails: [] });
    }
    const ph = explicitIds.map(() => "?").join(",");
    const sql = callerIsStaff
      ? `SELECT DISTINCT c.email FROM contacts c
          WHERE c.id IN (${ph}) AND c.email IS NOT NULL AND c.email <> ''`
      : `SELECT DISTINCT c.email
           FROM contacts c
           JOIN unlocked_contacts_v u ON u.contact_id = c.id AND u.user_id = ?
          WHERE c.id IN (${ph}) AND c.email IS NOT NULL AND c.email <> ''`;
    const params = callerIsStaff ? explicitIds : [session.id, ...explicitIds];
    const [rows] = await db.query(sql, params);
    recipients = (rows as any[]).map((r) => ({ email: r.email }));
  } else if (mode === "admin_all") {
    const [rows] = await db.query(
      `SELECT email FROM contacts WHERE email IS NOT NULL AND email <> ''`
    );
    recipients = (rows as any[]).map((r) => ({ email: r.email }));
  } else {
    const where: string[] = ["c.email IS NOT NULL", "c.email <> ''"];
    const params: any[] = [];
    if (!callerIsStaff) { where.unshift("u.user_id = ?"); params.push(session.id); }
    if (mode === "filtered" && search) {
      where.push("(LOWER(c.contact_name) LIKE ? OR LOWER(c.email) LIKE ?)");
      params.push(`%${search}%`, `%${search}%`);
    }
    if (filterCompanyIds.length === 1) {
      where.push("c.company_id = ?");
      params.push(filterCompanyIds[0]);
    } else if (filterCompanyIds.length > 1) {
      where.push(`c.company_id IN (${filterCompanyIds.map(() => "?").join(",")})`);
      params.push(...filterCompanyIds);
    }
    if (filterSegment)    { where.push("co.segment = ?");   params.push(filterSegment); }
    if (filterCountry)    { where.push("co.country = ?");   params.push(filterCountry); }
    if (filterDepartment) { where.push("c.department = ?"); params.push(filterDepartment); }

    const fromParts: string[] = ["contacts c"];
    if (!callerIsStaff) fromParts.push("JOIN unlocked_contacts_v u ON u.contact_id = c.id");
    if (filterSegment || filterCountry) {
      fromParts.push("LEFT JOIN companies co ON co.company_id = c.company_id");
    }
    const [rows] = await db.query(
      `SELECT DISTINCT c.email FROM ${fromParts.join(" ")} WHERE ${where.join(" AND ")}`,
      params
    );
    recipients = (rows as any[]).map((r) => ({ email: r.email }));
  }

  // Mirror the dedupe logic of POST /api/campaigns so the counts shown to
  // the user match what the server will actually do.
  {
    const seen = new Set<string>();
    const deduped: typeof recipients = [];
    for (const r of recipients) {
      const key = String(r.email || "").trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      deduped.push({ email: key });
    }
    recipients = deduped;
  }

  const suppressionSet = await loadSuppressionSet(session.id);
  const suppressedEmails: string[] = [];
  let willSend = 0;
  for (const r of recipients) {
    if (isSuppressed(r.email, suppressionSet)) {
      // Cap the list returned to UI at 20 so we don't ship megabytes.
      if (suppressedEmails.length < 20) suppressedEmails.push(r.email);
    } else {
      willSend++;
    }
  }

  return NextResponse.json({
    total: recipients.length,
    willSend,
    suppressed: recipients.length - willSend,
    suppressedEmails,
  });
}
