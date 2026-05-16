import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { isStaff } from "@/lib/admin";

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

  await db.query(
    `INSERT INTO companies
       (company_id, user_id, company_name, industry, segment, size, website, linkedin, country)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      company_id,
      session.id,
      name,
      normStr(body.type),
      normStr(body.segment),
      normStr(body.size),
      normStr(body.website),
      normStr(body.linkedin),
      normStr(body.country),
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
  const limit = Math.min(Number(url.searchParams.get("limit") || 5000), 10000);
  const staffBypass = isStaff(session.role);

  // Staff (admin + moderator) see every company; regular users only see rows they own
  // PLUS legacy/global rows where user_id IS NULL (so they have something to start with).
  const where = staffBypass ? "" : "WHERE c.user_id = ? OR c.user_id IS NULL";
  const params: any[] = staffBypass ? [] : [session.id];

  const [rows] = await db.query(
    `SELECT
        c.company_id,
        c.user_id,
        c.company_name,
        c.industry AS company_type,
        c.segment,
        c.size,
        c.country,
        c.website,
        c.linkedin,
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
    const cityCountry = [meta.city_regency, row.country].filter(Boolean).join(", ");
    return {
      company_id: row.company_id,
      name: meta.trading_name || meta.legal_name || row.company_name || row.company_id,
      company_name: row.company_name,
      companyType: row.company_type ?? "",
      segment: row.segment ?? "",
      size: row.size ?? "",
      location: cityCountry,
      country: row.country ?? "",
      website: row.website ?? "",
      linkedin: row.linkedin ?? "",
      contacts: Number(row.contact_count) || 0,
      created_at: row.created_at,
      owned: row.user_id === session.id,
    };
  });

  return NextResponse.json({ data });
}
