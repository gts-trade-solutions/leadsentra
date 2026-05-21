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
  const meta = JSON.stringify({
    department: body.department ?? null,
    location: body.location ?? null,
    notes: body.notes ?? null,
    facebook_url: body.facebook_url ?? null,
    instagram_url: body.instagram_url ?? null,
  });

  await db.execute(
    `INSERT INTO contacts (id, user_id, company_id, contact_name, email, title, phone, linkedin_url, meta)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS JSON))`,
    [
      id,
      session.id,
      body.company_id || null,
      body.contact_name || null,
      emailIn,
      body.title || null,
      body.phone || null,
      body.linkedin_url || null,
      meta,
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

  // location / department / notes / facebook_url / instagram_url live inside
  // the `meta` JSON column (POST handler stuffs them there). Extract them
  // here so the contacts page can display them as proper columns instead of
  // dashes. JSON_UNQUOTE turns a JSON-null into a SQL NULL — exactly what
  // the UI's optional fields expect.
  const sql = `SELECT
        c.id,
        c.contact_name AS name,
        c.title,
        c.email,
        c.phone,
        c.linkedin_url,
        JSON_UNQUOTE(JSON_EXTRACT(c.meta, '$.location'))      AS location,
        JSON_UNQUOTE(JSON_EXTRACT(c.meta, '$.department'))    AS department,
        JSON_UNQUOTE(JSON_EXTRACT(c.meta, '$.notes'))         AS notes,
        JSON_UNQUOTE(JSON_EXTRACT(c.meta, '$.facebook_url'))  AS facebook_url,
        JSON_UNQUOTE(JSON_EXTRACT(c.meta, '$.instagram_url')) AS instagram_url,
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
