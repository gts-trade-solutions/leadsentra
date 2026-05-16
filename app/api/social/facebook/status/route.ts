import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/social/facebook/status
 *
 * Mirrors the shape returned by /api/social/linkedin/status so the
 * multi-channel UI can treat both providers uniformly.
 */
export async function GET() {
  const session = await getUser();
  if (!session) return NextResponse.json({ connected: false }, { status: 401 });

  const [rows] = await db.execute(
    `SELECT fb_user_id, page_name, selected_page_id, selected_page_name,
            page_ids, expires_at, page_access_token
       FROM social_accounts
      WHERE user_id = ? AND provider = 'facebook'
      LIMIT 1`,
    [session.id]
  );
  const row = (rows as any[])[0];
  if (!row || !row.page_access_token) {
    return NextResponse.json({ connected: false });
  }

  let pages: any[] = [];
  try {
    pages = typeof row.page_ids === "string" ? JSON.parse(row.page_ids) : (row.page_ids ?? []);
  } catch {}

  return NextResponse.json({
    connected: true,
    fb_user_id: row.fb_user_id,
    page_id: row.selected_page_id,
    page_name: row.selected_page_name,
    pages, // [{id, name, instagram_business_account_id}]
    expires_at: row.expires_at,
  });
}
