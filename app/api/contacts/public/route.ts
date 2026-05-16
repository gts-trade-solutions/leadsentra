import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Public, unauthenticated read-only feed of contacts.
 * Returns up to 5000 rows enriched with company_name.
 */
export async function GET() {
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
       ORDER BY c.created_at DESC
       LIMIT 5000`
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
