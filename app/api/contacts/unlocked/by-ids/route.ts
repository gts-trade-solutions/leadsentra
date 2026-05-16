import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { isStaff } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/contacts/unlocked/by-ids
 * Body: { ids: string[] }
 * Returns: { contacts: [{ contact_id, contact_name, email }] }
 *
 * Used by the audience picker's "Selected" view to render names/emails
 * for the ids the user has selected without paging through the full list.
 * Staff (admin/moderator) can hydrate any contact id, not just ones in their unlock set.
 */
export async function POST(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ contacts: [] }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.ids)
    ? body.ids.filter((x: any) => typeof x === "string" && x).slice(0, 5000)
    : [];

  if (!ids.length) return NextResponse.json({ contacts: [] });

  const placeholders = ids.map(() => "?").join(",");

  if (isStaff(session.role)) {
    const [rows] = await db.query(
      `SELECT id AS contact_id, contact_name, email
         FROM contacts
        WHERE id IN (${placeholders})
          AND email IS NOT NULL AND email <> ''
        ORDER BY contact_name ASC`,
      ids
    );
    return NextResponse.json({ contacts: rows });
  }

  const [rows] = await db.query(
    `SELECT contact_id, contact_name, email
       FROM unlocked_contacts_v
      WHERE user_id = ?
        AND contact_id IN (${placeholders})
        AND email IS NOT NULL AND email <> ''
      ORDER BY contact_name ASC`,
    [session.id, ...ids]
  );

  return NextResponse.json({ contacts: rows });
}
