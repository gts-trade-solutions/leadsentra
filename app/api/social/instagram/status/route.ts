import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Instagram has no separate OAuth — it piggybacks on the Facebook
 * connection.  A user has IG posting if:
 *   1. They've connected Facebook AND
 *   2. The currently-selected Page has an instagram_business_account
 */
export async function GET() {
  const session = await getUser();
  if (!session) return NextResponse.json({ connected: false }, { status: 401 });

  const [rows] = await db.execute(
    `SELECT selected_page_id, selected_page_name, page_ids
       FROM social_accounts
      WHERE user_id = ? AND provider = 'facebook'
      LIMIT 1`,
    [session.id]
  );
  const row = (rows as any[])[0];
  if (!row?.selected_page_id) {
    return NextResponse.json({
      connected: false,
      reason: "Facebook not connected — Instagram uses the same connection.",
    });
  }

  let pages: any[] = [];
  try {
    pages = typeof row.page_ids === "string" ? JSON.parse(row.page_ids) : (row.page_ids ?? []);
  } catch {}

  const selected = pages.find((p) => p.id === row.selected_page_id);
  const igId = selected?.instagram_business_account_id ?? null;
  if (!igId) {
    return NextResponse.json({
      connected: false,
      reason: "The selected Facebook Page has no Instagram Business account linked.",
      page_name: row.selected_page_name,
    });
  }

  return NextResponse.json({
    connected: true,
    page_name: row.selected_page_name,
    instagram_user_id: igId,
  });
}
