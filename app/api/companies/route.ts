import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { isStaff } from "@/lib/admin";
import { cleanDepartments } from "@/lib/departments";
import { getApprovedCompanyIds } from "@/lib/memberships";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const normStr = (v: unknown) =>
  typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v ?? null;

export async function POST(req: NextRequest) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const code = normStr(body.code) as string | null;
  const name = normStr(body.name) as string | null;

  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const company_id = code || randomUUID();

  // Reject if this user already owns a company with that id
  const [dup] = await db.execute(
    "SELECT company_id FROM companies WHERE company_id = ? LIMIT 1",
    [company_id]
  );
  if ((dup as any[]).length) {
    return NextResponse.json(
      { error: "A company with that code already exists" },
      { status: 409 }
    );
  }

  // Fields that have proper SQL columns. Everything else (legal_name,
  // trading_name, head_office_address, postal_code, email_general, notes,
  // company_profile, financial_reports, forecast_value) is stored in the
  // meta JSON column so the form's full payload survives a round-trip.
  const meta: Record<string, any> = {};
  for (const key of [
    "legal_name",
    "trading_name",
    "head_office_address",
    "postal_code",
    "email_general",
    "notes",
    "company_profile",
    "financial_reports",
    "forecast_value",
  ] as const) {
    const v = normStr((body as any)[key]);
    if (v !== null) meta[key] = v;
  }

  // Departments (e.g. "LBI", "Research") are stored as a JSON array under
  // meta.departments. Trim, drop blanks, and de-dupe case-insensitively while
  // preserving the order the user entered them in.
  const depts = cleanDepartments((body as any).departments);
  if (depts.length) meta.departments = depts;

  await db.query(
    `INSERT INTO companies
       (company_id, user_id, company_name, industry, segment, size,
        website, linkedin, facebook_url, instagram_url, country, city_regency, phone_main, meta)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))`,
    [
      company_id,
      session.id,
      name,
      normStr(body.type),
      normStr(body.segment),
      normStr(body.size),
      normStr(body.website),
      normStr(body.linkedin),
      normStr(body.facebook_url),
      normStr(body.instagram_url),
      normStr(body.country),
      normStr(body.city_regency),
      normStr(body.phone_main),
      Object.keys(meta).length ? JSON.stringify(meta) : null,
    ]
  );

  const [rows] = await db.execute(
    "SELECT * FROM companies WHERE company_id = ? LIMIT 1",
    [company_id]
  );
  return NextResponse.json({ company: (rows as any[])[0] }, { status: 201 });
}

export async function GET(req: NextRequest) {
  const session = await getUser();
  if (!session) return NextResponse.json({ data: [] }, { status: 401 });

  const url = new URL(req.url);
  // Default high enough that dropdowns/pickers receive the full company list
  // (they were silently capped at 5000 before). Hard ceiling guards the DB.
  const limit = Math.min(Number(url.searchParams.get("limit") || 100000), 100000);
  const staffBypass = isStaff(session.role);

  // Staff (admin + moderator) see every company; regular users see rows they own,
  // legacy/global rows (user_id IS NULL), PLUS any company they're an approved
  // member of (the company-access / join-request flow).
  let where = "";
  const params: any[] = [];
  if (!staffBypass) {
    const approved = await getApprovedCompanyIds(session.id);
    const clauses = ["c.user_id = ?", "c.user_id IS NULL"];
    params.push(session.id);
    if (approved.length) {
      clauses.push(`c.company_id IN (${approved.map(() => "?").join(", ")})`);
      params.push(...approved);
    }
    where = `WHERE ${clauses.join(" OR ")}`;
  }

  const [rows] = await db.query(
    `SELECT
        c.company_id,
        c.user_id,
        c.company_name,
        c.industry AS company_type,
        c.segment,
        c.size,
        c.country,
        c.city_regency,
        c.phone_main,
        c.website,
        c.linkedin,
        c.facebook_url,
        c.instagram_url,
        c.meta,
        c.created_at,
        COALESCE(cc.contact_count, 0) AS contact_count
      FROM companies c
      LEFT JOIN company_contact_counts cc ON cc.company_id = c.company_id
      ${where}
      ORDER BY c.created_at DESC
      LIMIT ${limit}`,
    params
  );

  const data = (rows as any[]).map((row) => {
    const meta = (() => {
      try { return typeof row.meta === "string" ? JSON.parse(row.meta) : row.meta || {}; }
      catch { return {}; }
    })();
    // city_regency and phone_main now live on direct columns (the importer
    // writes there). Fall back to legacy `meta.*` so older rows that only
    // stored these inside the JSON blob still render.
    const cityRegency = row.city_regency ?? meta.city_regency ?? "";
    const phoneMain   = row.phone_main   ?? meta.phone_main   ?? "";
    const cityCountry = [cityRegency, row.country].filter(Boolean).join(", ");
    return {
      company_id: row.company_id,
      name: meta.trading_name || meta.legal_name || row.company_name || row.company_id,
      company_name: row.company_name,
      companyType: row.company_type ?? "",
      segment: row.segment ?? "",
      size: row.size ?? "",
      // Exposed as first-class fields so the table can render them without
      // re-parsing strings or meta JSON.
      city_regency: cityRegency,
      phone: phoneMain,
      location: cityCountry,
      country: row.country ?? "",
      website: row.website ?? "",
      linkedin: row.linkedin ?? "",
      facebook_url: row.facebook_url ?? "",
      instagram_url: row.instagram_url ?? "",
      contacts: Number(row.contact_count) || 0,
      created_at: row.created_at,
      owned: row.user_id === session.id,
    };
  });

  return NextResponse.json({ data });
}
