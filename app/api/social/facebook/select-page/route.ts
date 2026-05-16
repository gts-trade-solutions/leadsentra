import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FB_VERSION = process.env.FACEBOOK_API_VERSION || "v19.0";

/**
 * POST /api/social/facebook/select-page  body { page_id }
 *
 * The user picked a different Page than the one we auto-selected during
 * OAuth.  Fetch a fresh page access_token for that Page and store it.
 */
export async function POST(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const pageId = String(body?.page_id || "");
  if (!pageId) return NextResponse.json({ error: "page_id required" }, { status: 400 });

  const [rows] = await db.execute(
    `SELECT access_token FROM social_accounts WHERE user_id = ? AND provider = 'facebook' LIMIT 1`,
    [session.id]
  );
  const userToken = (rows as any[])[0]?.access_token as string | undefined;
  if (!userToken) return NextResponse.json({ error: "Not connected" }, { status: 400 });

  // Fetch the page's own access_token + name via the user token.
  const resp = await fetch(
    `https://graph.facebook.com/${FB_VERSION}/${encodeURIComponent(pageId)}?fields=id,name,access_token&access_token=${encodeURIComponent(userToken)}`
  );
  const json: any = await resp.json().catch(() => ({}));
  if (!resp.ok || !json?.access_token) {
    return NextResponse.json(
      { error: json?.error?.message || "Could not fetch page token" },
      { status: 400 }
    );
  }

  await db.execute(
    `UPDATE social_accounts
        SET selected_page_id = ?, selected_page_name = ?, page_access_token = ?, updated_at = NOW()
      WHERE user_id = ? AND provider = 'facebook'`,
    [json.id, json.name, json.access_token, session.id]
  );

  return NextResponse.json({ ok: true, page_id: json.id, page_name: json.name });
}
