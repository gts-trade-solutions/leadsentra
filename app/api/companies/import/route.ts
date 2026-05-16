import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import Papa from "papaparse";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { isStaff } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RowError = { row: number; error: string };

// Header aliases — accept whatever the user's CSV uses.  Maps any of these
// headers to a single canonical key.  Case-insensitive (we lower-case headers).
const HEADER_ALIASES: Record<string, string[]> = {
  code:                ["code", "company_id", "id"],
  name:                ["name", "company_name", "company"],
  type:                ["type", "company_type", "industry"],
  size:                ["size", "employees", "employee_count"],
  website:             ["website", "url", "domain"],
  linkedin:            ["linkedin", "linkedin_url"],
  country:             ["country"],
  legal_name:          ["legal_name"],
  trading_name:        ["trading_name"],
  head_office_address: ["head_office_address", "address"],
  city_regency:        ["city_regency", "city"],
  postal_code:         ["postal_code", "zip", "zipcode"],
  phone_main:          ["phone_main", "phone"],
  email_general:       ["email_general", "email"],
  notes:               ["notes"],
  company_profile:     ["company_profile", "profile"],
  financial_reports:   ["financial_reports"],
  forecast_value:      ["forecast_value"],
};

function buildAliasLookup() {
  const lookup: Record<string, string> = {};
  for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
    for (const a of aliases) lookup[a.toLowerCase()] = canonical;
  }
  return lookup;
}

const REQUIRED_CANONICAL = ["name"];

export async function POST(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Bulk CSV import is staff-only. Regular users use the per-row Add Company modal.
  if (!isStaff(session.role)) {
    return NextResponse.json({ error: "Bulk import is staff-only" }, { status: 403 });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "File too large (max 5MB)" }, { status: 413 });
  }

  const text = await file.text();
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  });

  if (parsed.errors.length) {
    return NextResponse.json(
      {
        error: "CSV parse error",
        detail: parsed.errors.slice(0, 5).map((e) => e.message),
      },
      { status: 400 }
    );
  }

  const aliasLookup = buildAliasLookup();
  const rawHeaders = parsed.meta.fields ?? [];
  const headerMap: Record<string, string> = {};
  for (const h of rawHeaders) {
    const canonical = aliasLookup[h];
    if (canonical) headerMap[h] = canonical;
  }
  const canonicalHeaders = new Set(Object.values(headerMap));

  // Validate required columns (matching any alias is fine)
  const missing = REQUIRED_CANONICAL.filter((r) => !canonicalHeaders.has(r));
  if (missing.length) {
    const acceptedFor = missing
      .map((m) => `${m} (accepted: ${HEADER_ALIASES[m].join(", ")})`)
      .join("; ");
    return NextResponse.json(
      { error: `Missing required column: ${acceptedFor}` },
      { status: 400 }
    );
  }

  let inserted = 0;
  let failed = 0;
  const errors: RowError[] = [];

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    for (let i = 0; i < parsed.data.length; i++) {
      const raw = parsed.data[i];
      const row: Record<string, string | null> = {};

      // Translate raw headers → canonical keys
      for (const [rawHeader, canonical] of Object.entries(headerMap)) {
        const v = (raw[rawHeader] ?? "").toString().trim();
        row[canonical] = v || null;
      }

      const name = row.name;
      if (!name) {
        failed++;
        errors.push({ row: i + 2, error: "Missing name" });
        continue;
      }

      const company_id = row.code || randomUUID();
      const forecastValue =
        row.forecast_value && !isNaN(Number(row.forecast_value))
          ? Number(row.forecast_value)
          : null;

      try {
        await conn.execute(
          `INSERT INTO companies
             (company_id, user_id, company_name, industry, size, website, linkedin, country,
              legal_name, trading_name, company_type, head_office_address, city_regency,
              postal_code, phone_main, email_general, notes, company_profile,
              financial_reports, forecast_value)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            company_id,
            session.id,
            name,
            row.type ?? null,
            row.size ?? null,
            row.website ?? null,
            row.linkedin ?? null,
            row.country ?? null,
            row.legal_name ?? null,
            row.trading_name ?? null,
            row.type ?? null,
            row.head_office_address ?? null,
            row.city_regency ?? null,
            row.postal_code ?? null,
            row.phone_main ?? null,
            row.email_general ?? null,
            row.notes ?? null,
            row.company_profile ?? null,
            row.financial_reports ?? null,
            forecastValue,
          ]
        );
        inserted++;
      } catch (e: any) {
        failed++;
        const msg =
          e?.code === "ER_DUP_ENTRY"
            ? `Duplicate company_id "${company_id}"`
            : e?.message || "Insert failed";
        errors.push({ row: i + 2, error: msg });
      }
    }

    await conn.commit();
  } catch (e: any) {
    await conn.rollback();
    return NextResponse.json({ error: e?.message || "Import failed" }, { status: 500 });
  } finally {
    conn.release();
  }

  return NextResponse.json({
    inserted,
    failed,
    errors: errors.slice(0, 50),
    parsed: parsed.data.length,
  });
}
