import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Every column the UI shows or the importer accepts, in the same order and
 * under the same header names as the import template — so an export can be
 * edited and re-imported without renaming anything.
 *
 * This used to select seven columns (code/name/type/size/website/linkedin/
 * country), which silently dropped segment, the addresses, the contact
 * details and the profile fields that are visible on the site.
 *
 * `departments` is appended for reference; the importer ignores unknown
 * headers, so its presence is harmless on a round trip.
 */
const COLUMNS = [
  "code",
  "name",
  "legal_name",
  "trading_name",
  "type",
  "segment",
  "size",
  "head_office_address",
  "region",
  "country",
  "postal_code",
  "website",
  "phone_main",
  "email_general",
  "linkedin",
  "facebook_url",
  "instagram_url",
  "notes",
  "company_profile",
  "financial_reports",
  "forecast_value",
  "departments",
  "created_at",
] as const;

export async function GET() {
  const session = await getUser();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const isAdmin = session.role === "admin";
  const where = isAdmin ? "" : "WHERE user_id = ? OR user_id IS NULL";
  const params: any[] = isAdmin ? [] : [session.id];

  const [rows] = await db.execute(
    `SELECT company_id                          AS code,
            company_name                        AS name,
            legal_name,
            trading_name,
            COALESCE(company_type, industry)    AS type,
            segment,
            size,
            head_office_address,
            city_regency                        AS region,
            country,
            postal_code,
            website,
            phone_main,
            email_general,
            linkedin,
            facebook_url,
            instagram_url,
            notes,
            company_profile,
            financial_reports,
            forecast_value,
            meta,
            created_at
       FROM companies
       ${where}
       ORDER BY created_at DESC
       LIMIT 100000`,
    params
  );

  const out: string[] = [COLUMNS.join(",")];
  for (const r of rows as any[]) {
    // Departments live as a JSON array under meta; flatten to "A; B; C".
    let departments = "";
    try {
      const meta = typeof r.meta === "string" ? JSON.parse(r.meta) : r.meta;
      if (Array.isArray(meta?.departments)) departments = meta.departments.join("; ");
    } catch {
      /* malformed meta — leave the cell blank */
    }
    const row = { ...r, departments };
    out.push(COLUMNS.map((h) => csvEscape(row[h])).join(","));
  }
  const body = out.join("\n");
  const ts = new Date().toISOString().slice(0, 10);

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="companies-${ts}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
