import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { isStaff } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Authenticated read-only feed of contacts.
 *
 * Originally written as a public "showcase" endpoint that returned 5000
 * contacts with PII (email / phone / social URLs) to anyone who could
 * reach the URL — a serious data leak. Now requires auth and scopes
 * results the same way /api/contacts does: staff see everything, regular
 * users only see contacts they've already unlocked.
 */
export async function GET() {
  const session = await getUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized", rows: [] }, { status: 401 });
  }

  const staffBypass = isStaff(session.role);
  const unlockJoin = staffBypass
    ? ""
    : "JOIN unlocked_contacts uc ON uc.contact_id = c.id AND uc.user_id = ?";
  const params: any[] = staffBypass ? [] : [session.id];

  const [rows] = await db.execute(
    `SELECT c.id,
            c.company_id,
            c.contact_name AS name,
            c.title,
            c.email,
            c.phone,
            c.location,
            c.linkedin_url,
            c.facebook_url,
            c.instagram_url,
            co.company_name
       FROM contacts c
       LEFT JOIN companies co ON co.company_id = c.company_id
       ${unlockJoin}
       ORDER BY c.created_at DESC
       LIMIT 5000`,
    params
  );

  const out = (rows as any[]).map((c) => ({
    id: c.id,
    name: c.name ?? "",
    title: c.title ?? "",
    company: c.company_name || String(c.company_id || ""),
    email: c.email ?? null,
    phone: c.phone ?? null,
    location: c.location ?? null,
    linkedin_url: c.linkedin_url ?? null,
    facebook_url: c.facebook_url ?? null,
    instagram_url: c.instagram_url ?? null,
  }));

  return NextResponse.json({ rows: out });
}
