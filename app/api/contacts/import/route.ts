import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import Papa from "papaparse";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { isStaff } from "@/lib/admin";
import { isEmailShape } from "@/lib/suppressions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RowError = { row: number; error: string };

const HEADER_ALIASES: Record<string, string[]> = {
  contact_name:  ["contact_name", "name", "full_name"],
  email:         ["email", "email_address"],
  title:         ["title", "job_title", "designation"],
  phone:         ["phone", "phone_number", "mobile"],
  linkedin_url:  ["linkedin_url", "linkedin"],
  facebook_url:  ["facebook_url", "facebook"],
  instagram_url: ["instagram_url", "instagram"],
  company_id:    ["company_id", "company"],
  department:    ["department"],
  location:      ["location", "city", "address"],
  notes:         ["notes"],
};

function buildAliasLookup() {
  const lookup: Record<string, string> = {};
  for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
    for (const a of aliases) lookup[a.toLowerCase()] = canonical;
  }
  return lookup;
}

const REQUIRED_CANONICAL = ["email"];

export async function POST(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Bulk CSV import is staff-only. Regular users use the per-row Add Contact modal.
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
      { error: "CSV parse error", detail: parsed.errors.slice(0, 5).map((e) => e.message) },
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

  // Build a one-shot lookup of every existing company so we can resolve a
  // `company_id` cell that actually contains a company NAME (a very common
  // mistake when users fill the contacts template after importing companies
  // with auto-generated UUIDs). Maps both real ids and lower-cased names →
  // canonical company_id.
  const companyLookup = new Map<string, string>();
  {
    const [companyRows] = await db.execute(
      "SELECT company_id, company_name FROM companies"
    );
    for (const c of companyRows as any[]) {
      const id = String(c.company_id ?? "").trim();
      const nm = String(c.company_name ?? "").trim().toLowerCase();
      if (id) companyLookup.set(id, id);
      if (nm) companyLookup.set(nm, id);
    }
  }
  function resolveCompanyId(raw: string | null): string | null {
    if (!raw) return null;
    const v = raw.trim();
    if (!v) return null;
    // Try exact id, then case-insensitive name. Falls back to the raw value
    // so existing flows that already used valid UUIDs keep working unchanged.
    return companyLookup.get(v) ?? companyLookup.get(v.toLowerCase()) ?? v;
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    for (let i = 0; i < parsed.data.length; i++) {
      const raw = parsed.data[i];
      const row: Record<string, string | null> = {};
      for (const [rawHeader, canonical] of Object.entries(headerMap)) {
        const v = (raw[rawHeader] ?? "").toString().trim();
        row[canonical] = v || null;
      }

      const email = row.email ? row.email.trim().toLowerCase() : null;
      if (!email) {
        failed++; errors.push({ row: i + 2, error: "Missing email" });
        continue;
      }
      if (!isEmailShape(email)) {
        failed++; errors.push({ row: i + 2, error: `Invalid email format: ${email}` });
        continue;
      }

      const resolvedCompanyId = resolveCompanyId(row.company_id ?? null);

      const id = randomUUID();
      try {
        await conn.execute(
          `INSERT INTO contacts
             (id, user_id, company_id, contact_name, email, title, phone,
              linkedin_url, facebook_url, instagram_url, department, location, notes)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            id,
            session.id,
            resolvedCompanyId,
            row.contact_name ?? null,
            email,
            row.title ?? null,
            row.phone ?? null,
            row.linkedin_url ?? null,
            row.facebook_url ?? null,
            row.instagram_url ?? null,
            row.department ?? null,
            row.location ?? null,
            row.notes ?? null,
          ]
        );
        inserted++;
      } catch (e: any) {
        failed++;
        errors.push({ row: i + 2, error: e?.message || "Insert failed" });
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
