import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/companies/public?q=...
 * Unauthenticated, minimal company list (id + name) used by the signup page so
 * a new user can pick which company to request to join. Returns id + name only.
 *
 * The search matches the company CODE as well as the name — people are given a
 * code like "SWE02" as often as a full company name, and searching it returned
 * nothing before.
 *
 * `total` comes back alongside the rows so the caller can say "showing 500 of
 * 1,240 — keep typing" instead of silently presenting a truncated list as if
 * it were everything.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const limit = Math.min(Number(url.searchParams.get("limit") || 500), 1000);

  const where = "WHERE company_name IS NOT NULL AND TRIM(company_name) <> ''";
  const search = q ? " AND (company_name LIKE ? OR company_id LIKE ?)" : "";
  const params = q ? [`%${q}%`, `%${q}%`] : [];

  const [rows] = await db.execute(
    `SELECT company_id, company_name FROM companies
      ${where}${search}
      ORDER BY company_name ASC
      LIMIT ${limit}`,
    params
  );
  const [countRows] = await db.execute(
    `SELECT COUNT(*) AS total FROM companies ${where}${search}`,
    params
  );

  const data = (rows as any[]).map((row) => ({
    company_id: row.company_id,
    name: row.company_name,
  }));
  const total = Number((countRows as any[])[0]?.total || 0);
  return NextResponse.json({ data, total, truncated: total > data.length });
}
