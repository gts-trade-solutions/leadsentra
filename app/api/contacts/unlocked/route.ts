import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { isStaff } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/contacts/unlocked
 *
 * Query params:
 *   q          search (matches name or email; lower-cased server-side)
 *   limit      page size (max 500, default 50)
 *   offset     pagination offset
 *   count      "only" — return ONLY the total count, no rows
 *   segment    filter contacts whose company's `segment` equals this
 *   country    filter contacts whose company's `country` equals this
 *   company_id filter contacts under a specific company
 *
 * Staff (admin/moderator) get the *entire* contacts table (no unlock filter).
 * Regular users see only contacts they've unlocked.
 *
 * Filter joins happen on demand — when no segment/country/company_id is set,
 * we skip the JOIN to keep the unfiltered case fast.
 */
export async function GET(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ contacts: [], total: 0 }, { status: 401 });

  const url = new URL(req.url);
  const q          = (url.searchParams.get("q") || "").trim().toLowerCase();
  const segment    = (url.searchParams.get("segment") || "").trim();
  const country    = (url.searchParams.get("country") || "").trim();
  const department = (url.searchParams.get("department") || "").trim();
  // Multi-select aware: caller can pass company_id repeatedly (?company_id=a&company_id=b)
  // or as a comma-separated single value (?company_id=a,b). Both legacy single-value
  // callers and the new multi-select Audience picker round-trip cleanly.
  const companyIds = url.searchParams
    .getAll("company_id")
    .flatMap((v) => v.split(","))
    .map((v) => v.trim())
    .filter(Boolean);
  const limit      = Math.min(Math.max(Number(url.searchParams.get("limit") || 50), 1), 500);
  const offset     = Math.max(Number(url.searchParams.get("offset") || 0), 0);
  const countOnly  = url.searchParams.get("count") === "only";

  const staffBypass = isStaff(session.role);
  const needsCompaniesJoin = !!(segment || country);

  // ---------- WHERE ----------
  // Only 'lead' contacts are mailable — normal CRM contacts never appear in a
  // campaign audience. This is the picker feeding the campaign composer, so it
  // must mirror the same filter applied in /api/campaigns.
  const where: string[] = ["c.contact_type = 'lead'", "c.email IS NOT NULL", "c.email <> ''"];
  const params: any[] = [];

  if (!staffBypass) {
    // Bind to the unlocked_contacts view: only rows this user has unlocked.
    where.unshift("uc.user_id = ?");
    params.push(session.id);
  }
  if (q) {
    where.push("(LOWER(c.contact_name) LIKE ? OR LOWER(c.email) LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }
  if (companyIds.length === 1) {
    where.push("c.company_id = ?");
    params.push(companyIds[0]);
  } else if (companyIds.length > 1) {
    where.push(`c.company_id IN (${companyIds.map(() => "?").join(",")})`);
    params.push(...companyIds);
  }
  if (segment) {
    where.push("co.segment = ?");
    params.push(segment);
  }
  if (country) {
    where.push("co.country = ?");
    params.push(country);
  }
  if (department) {
    where.push("c.department = ?");
    params.push(department);
  }

  // ---------- FROM ----------
  // Always start from `contacts c` and JOIN unlocked_contacts only for non-staff.
  // JOIN companies only when a segment/country filter is set (cheap when not).
  const fromParts: string[] = ["contacts c"];
  if (!staffBypass) {
    fromParts.push("JOIN unlocked_contacts uc ON uc.contact_id = c.id");
  }
  if (needsCompaniesJoin) {
    fromParts.push("LEFT JOIN companies co ON co.company_id = c.company_id");
  }
  const fromSql = fromParts.join(" ");
  const whereSql = where.join(" AND ");

  // ---------- queries ----------
  const [[totalRow]] = await db.query(
    `SELECT COUNT(DISTINCT c.id) AS total FROM ${fromSql} WHERE ${whereSql}`,
    params
  ) as any;
  const total = Number(totalRow?.total || 0);

  if (countOnly) {
    return NextResponse.json({ contacts: [], total });
  }

  const [rows] = await db.query(
    `SELECT DISTINCT c.id AS contact_id, c.contact_name, c.email
       FROM ${fromSql}
      WHERE ${whereSql}
      ORDER BY c.contact_name ASC, c.email ASC
      LIMIT ${limit} OFFSET ${offset}`,
    params
  );

  return NextResponse.json({ contacts: rows, total });
}
