import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { isStaff } from "@/lib/admin";
import { isEmailShape } from "@/lib/suppressions";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));

  // Validate email format if provided.  Empty/null is allowed (some contacts
  // are added before their email is known) — but a non-empty value must be
  // a real-looking address; otherwise it silently breaks future campaign sends.
  const emailIn = body.email ? String(body.email).trim().toLowerCase() : null;
  if (emailIn && !isEmailShape(emailIn)) {
    return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
  }

  const id = randomUUID();
  // department / location / facebook_url / instagram_url / notes live as
  // proper SQL columns in production (added via the 2026-05-11 migration).
  // We previously stuffed these into the meta JSON, which made bulk-import
  // and single-add diverge — bulk wrote to columns, single wrote to JSON.
  // Writing to direct columns keeps both flows consistent.
  await db.execute(
    `INSERT INTO contacts
       (id, user_id, company_id, contact_name, email, title, phone,
        linkedin_url, facebook_url, instagram_url, department, location, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      session.id,
      body.company_id || null,
      body.contact_name || null,
      emailIn,
      body.title || null,
      body.phone || null,
      body.linkedin_url || null,
      body.facebook_url || null,
      body.instagram_url || null,
      body.department || null,
      body.location || null,
      body.notes || null,
    ]
  );

  return NextResponse.json({ id }, { status: 201 });
}

// Mirrors the old `contacts_list` RPC: returns rows annotated with is_unlocked
// for the current user.  See schema.sql for the stored procedure equivalent.
export async function GET(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ data: [] }, { status: 401 });

  const url = new URL(req.url);
  const search = url.searchParams.get("q") || "";
  const limit = Math.min(Number(url.searchParams.get("limit") || 1000), 5000);
  const offset = Math.max(Number(url.searchParams.get("offset") || 0), 0);

  const like = `%${search}%`;

  // Staff (admin/moderator) see everything unlocked — no lock UI, no unlock flow.
  const staffBypass = isStaff(session.role);
  const unlockedExpr = staffBypass ? "TRUE" : "(uc.contact_id IS NOT NULL)";
  const unlockJoin = staffBypass
    ? ""
    : "LEFT JOIN unlocked_contacts uc ON uc.contact_id = c.id AND uc.user_id = ?";

  // department / location / facebook_url / instagram_url / notes are direct
  // columns (added via 2026-05-11 migration). COALESCE falls back to the
  // meta JSON for any legacy rows that were written before the migration
  // landed — or to rows written briefly today while POST was routing data
  // through the JSON instead of columns.
  const sql = `SELECT
        c.id,
        c.contact_name AS name,
        c.title,
        c.email,
        c.phone,
        c.linkedin_url,
        COALESCE(c.location,      JSON_UNQUOTE(JSON_EXTRACT(c.meta, '$.location')))      AS location,
        COALESCE(c.department,    JSON_UNQUOTE(JSON_EXTRACT(c.meta, '$.department')))    AS department,
        COALESCE(c.notes,         JSON_UNQUOTE(JSON_EXTRACT(c.meta, '$.notes')))         AS notes,
        COALESCE(c.facebook_url,  JSON_UNQUOTE(JSON_EXTRACT(c.meta, '$.facebook_url')))  AS facebook_url,
        COALESCE(c.instagram_url, JSON_UNQUOTE(JSON_EXTRACT(c.meta, '$.instagram_url'))) AS instagram_url,
        co.company_name AS company,
        co.country     AS country,
        co.segment     AS segment,
        c.company_id,
        c.created_at,
        ${unlockedExpr} AS is_unlocked
     FROM contacts c
     LEFT JOIN companies co ON co.company_id = c.company_id
     ${unlockJoin}
     WHERE ? = '' OR c.contact_name LIKE ? OR c.email LIKE ? OR co.company_name LIKE ?
     ORDER BY c.created_at DESC
     LIMIT ${limit} OFFSET ${offset}`;
  const params = staffBypass
    ? [search, like, like, like]
    : [session.id, search, like, like, like];

  const [rows] = await db.execute(sql, params);
  return NextResponse.json({ data: rows });
}
