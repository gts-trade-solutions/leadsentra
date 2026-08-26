import { db } from "@/lib/db";
import { isAdmin } from "@/lib/admin";
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
  "phone_main_2",
  "phone_main_3",
  "email_general",
  "email_general_2",
  "email_general_3",
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

/**
 * Query params mirror the filters on the Companies page:
 *   q         free text over company_id / name / type / size / country / region
 *   type      repeatable, or comma-separated
 *   country   repeatable, or comma-separated
 *   segment   repeatable, or comma-separated
 *   size      exact match
 *   location  contains, over country / city_regency / head_office_address
 *   from,to   created_at range (YYYY-MM-DD, inclusive)
 *
 * The filters are applied in SQL rather than to the rows the browser happens
 * to hold, so a filtered download covers every matching company. Previously
 * this endpoint took no parameters at all: narrowing the table and clicking
 * Export still downloaded the entire database.
 */
export async function GET(req: Request) {
  const session = await getUser();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const sp = new URL(req.url).searchParams;
  const list = (name: string) =>
    sp.getAll(name).flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
  const one = (name: string) => (sp.get(name) || "").trim();

  const admin = isAdmin(session.role);
  const clauses: string[] = [];
  const params: any[] = [];

  if (!admin) {
    clauses.push("(user_id = ? OR user_id IS NULL)");
    params.push(session.id);
  }

  const q = one("q").toLowerCase();
  if (q) {
    clauses.push(
      `(LOWER(company_id) LIKE ? OR LOWER(company_name) LIKE ?
        OR LOWER(COALESCE(company_type, industry)) LIKE ? OR LOWER(size) LIKE ?
        OR LOWER(country) LIKE ? OR LOWER(city_regency) LIKE ?)`
    );
    params.push(...Array(6).fill(`%${q}%`));
  }

  const inList = (sql: string, values: string[]) => {
    if (!values.length) return;
    clauses.push(`${sql} IN (${values.map(() => "?").join(",")})`);
    params.push(...values);
  };
  inList("COALESCE(company_type, industry)", list("type"));
  inList("country", list("country"));
  inList("segment", list("segment"));

  const size = one("size");
  if (size) { clauses.push("size = ?"); params.push(size); }

  const location = one("location").toLowerCase();
  if (location) {
    clauses.push(
      "(LOWER(country) LIKE ? OR LOWER(city_regency) LIKE ? OR LOWER(head_office_address) LIKE ?)"
    );
    params.push(...Array(3).fill(`%${location}%`));
  }

  const from = one("from");
  const to = one("to");
  if (from) { clauses.push("created_at >= ?"); params.push(`${from} 00:00:00`); }
  if (to)   { clauses.push("created_at <= ?"); params.push(`${to} 23:59:59`); }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";

  const [rows] = await db.query(
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
            phone_main_2,
            phone_main_3,
            email_general,
            email_general_2,
            email_general_3,
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
  // CRLF + a UTF-8 BOM. Excel on Windows ignores the charset in the
  // Content-Type header when opening a local .csv and decodes it in the
  // system ANSI codepage instead — so "Messe München" opened as
  // "Messe MÃ¼nchen", and re-saving from Excel then wrote the unmappable
  // characters back as literal "?" (which is how names like "Aşkın İnci"
  // became "A?k?n ?nci"). The BOM is what makes Excel read it as UTF-8.
  const body = "﻿" + out.join("\r\n");
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
