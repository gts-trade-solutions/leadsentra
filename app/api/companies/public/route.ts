import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/companies/public?q=...
 * Unauthenticated, minimal company list (id + name) used by the signup page so
 * a new user can pick which company to request to join. Returns id + name only.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const limit = Math.min(Number(url.searchParams.get("limit") || 500), 1000);

  let rows: any[];
  if (q) {
    const [r] = await db.execute(
      `SELECT company_id, company_name FROM companies
        WHERE company_name LIKE ?
        ORDER BY company_name ASC LIMIT ${limit}`,
      [`%${q}%`]
    );
    rows = r as any[];
  } else {
    const [r] = await db.execute(
      `SELECT company_id, company_name FROM companies
        ORDER BY company_name ASC LIMIT ${limit}`
    );
    rows = r as any[];
  }

  const data = rows
    .filter((row) => row.company_name)
    .map((row) => ({ company_id: row.company_id, name: row.company_name }));
  return NextResponse.json({ data });
}
