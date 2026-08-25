import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { isStaff } from "@/lib/admin";
import { pushInClause } from "@/lib/audience";

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
 *   segment    company `segment` — repeatable, or comma-separated (OR'd)
 *   company_type company type — repeatable, or comma-separated (OR'd)
 *   country    company `country` — repeatable, or comma-separated (OR'd)
 *   company_id company — repeatable, or comma-separated (OR'd)
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
  const department = (url.searchParams.get("department") || "").trim();
  // Multi-select aware: each of these may be passed repeatedly
  // (?segment=a&segment=b) or as one comma-separated value (?segment=a,b).
  // Legacy single-value callers round-trip through the same path unchanged.
  const multiParam = (name: string) =>
    url.searchParams
      .getAll(name)
      .flatMap((v) => v.split(","))
      .map((v) => v.trim())
      .filter(Boolean);
  const segments   = multiParam("segment");
  const companyTypes = multiParam("company_type");
  const countries  = multiParam("country");
  const companyIds = multiParam("company_id");
  const limit      = Math.min(Math.max(Number(url.searchParams.get("limit") || 50), 1), 500);
  const offset     = Math.max(Number(url.searchParams.get("offset") || 0), 0);
  const countOnly  = url.searchParams.get("count") === "only";
  // Set by the Catalogues & Offers send flow only: restrict to 'lead' contacts.
  // Regular audience listings leave it off and show all contacts, as before.
  const leadsOnly  = url.searchParams.get("leads_only") === "1";

  const staffBypass = isStaff(session.role);
  const needsCompaniesJoin = !!(segments.length || countries.length || companyTypes.length);

  // ---------- WHERE ----------
  const where: string[] = ["c.email IS NOT NULL", "c.email <> ''"];
  if (leadsOnly) where.push("c.contact_type = 'lead'");
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
  pushInClause(where, params, "c.company_id", companyIds);
  pushInClause(where, params, "co.segment", segments);
  pushInClause(where, params, "co.country", countries);
  // The importer fills industry and company_type alike; the Add Company form
  // fills only industry. COALESCE is what matches a company however it arrived.
  pushInClause(where, params, "COALESCE(co.industry, co.company_type)", companyTypes);
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
