import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/companies/departments?company_id=a,b,c -> { departments: string[] }
 *
 * Departments have two sources and the UI needs both:
 *   1. companies.meta.departments — typed on the Companies edit form.
 *   2. contacts.department        — arrives with every contact import.
 *
 * The catalogue targeting dropdown previously read only (1), so it was empty
 * for every imported company even when their contacts carried departments.
 *
 * With no company_id, returns every department the caller can see, which is
 * what "all companies" targeting needs.
 */
export async function GET(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ departments: [] }, { status: 401 });

  const url = new URL(req.url);
  const ids = (url.searchParams.get("company_id") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const found = new Set<string>();

  const add = (value: unknown) => {
    const s = String(value ?? "").trim();
    if (s) found.add(s);
  };

  try {
    // (1) meta.departments on the companies themselves.
    const companySql = ids.length
      ? `SELECT meta FROM companies WHERE company_id IN (${ids.map(() => "?").join(", ")})`
      : "SELECT meta FROM companies";
    const [companyRows] = await db.query(companySql, ids);
    for (const row of companyRows as any[]) {
      if (!row?.meta) continue;
      try {
        const meta = typeof row.meta === "string" ? JSON.parse(row.meta) : row.meta;
        if (Array.isArray(meta?.departments)) meta.departments.forEach(add);
      } catch {
        /* malformed meta — skip this company */
      }
    }
  } catch (e) {
    console.error("[companies] department lookup (meta) failed", e);
  }

  try {
    // (2) whatever the contacts under those companies actually say.
    const contactSql = ids.length
      ? `SELECT DISTINCT department FROM contacts
          WHERE department IS NOT NULL AND TRIM(department) <> ''
            AND company_id IN (${ids.map(() => "?").join(", ")})`
      : `SELECT DISTINCT department FROM contacts
          WHERE department IS NOT NULL AND TRIM(department) <> ''`;
    const [contactRows] = await db.query(contactSql, ids);
    for (const row of contactRows as any[]) add(row?.department);
  } catch (e) {
    console.error("[companies] department lookup (contacts) failed", e);
  }

  const departments = Array.from(found).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
  return NextResponse.json({ departments });
}
