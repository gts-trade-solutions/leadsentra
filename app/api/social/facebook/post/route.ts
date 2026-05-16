import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { isStaff } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FB_VERSION = process.env.FACEBOOK_API_VERSION || "v19.0";
const PRICE_PER_POST = 1;

/**
 * POST /api/social/facebook/post
 * Body: { text: string, image_url?: string }
 *
 * Posts to the user's currently-selected Page using its page access token.
 * - text-only:  POST /{page_id}/feed   {message, access_token}
 * - with image: POST /{page_id}/photos {url, caption, access_token}
 *
 * Credits: 1 per post (staff bypass).
 */
export async function POST(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const text = String(body?.text || "").trim();
  const imageUrl = body?.image_url ? String(body.image_url) : null;
  if (!text && !imageUrl) {
    return NextResponse.json({ error: "Empty post" }, { status: 400 });
  }

  const [rows] = await db.execute(
    `SELECT selected_page_id, page_access_token
       FROM social_accounts
      WHERE user_id = ? AND provider = 'facebook'
      LIMIT 1`,
    [session.id]
  );
  const row = (rows as any[])[0];
  if (!row?.selected_page_id || !row?.page_access_token) {
    return NextResponse.json(
      { error: "Connect Facebook and pick a Page first" },
      { status: 400 }
    );
  }

  // Credit charge (skipped for staff)
  if (!isStaff(session.role)) {
    try {
      await db.query("CALL spend_credit(?, ?, ?, ?, ?)", [
        session.id,
        PRICE_PER_POST,
        "debit",
        `fb_post:${Date.now()}`,
        "Post to Facebook",
      ]);
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg.includes("insufficient_credits")) {
        return NextResponse.json(
          { error: "Insufficient credits", code: "insufficient_credits" },
          { status: 402 }
        );
      }
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  const pageId = row.selected_page_id;
  const pageToken = row.page_access_token;

  // Pick endpoint based on whether an image is attached.
  const endpoint = imageUrl
    ? `https://graph.facebook.com/${FB_VERSION}/${pageId}/photos`
    : `https://graph.facebook.com/${FB_VERSION}/${pageId}/feed`;
  const fields: Record<string, string> = imageUrl
    ? { url: imageUrl, caption: text, access_token: pageToken }
    : { message: text, access_token: pageToken };

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
  const json: any = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    return NextResponse.json(
      { error: json?.error?.message || "Facebook post failed" },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true, id: json?.id || json?.post_id || null });
}
