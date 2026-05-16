import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { isStaff } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FB_VERSION = process.env.FACEBOOK_API_VERSION || "v19.0";
const PRICE_PER_POST = 1;

/**
 * POST /api/social/instagram/post
 * Body: { text: string, image_url: string  (required for IG) }
 *
 * Instagram Graph API requires a PUBLIC https image_url.  Two-step publish:
 *   1) POST /{ig-user}/media   { image_url, caption } → container_id
 *   2) POST /{ig-user}/media_publish { creation_id }   → post_id
 *
 * Uses the page access token (IG Business runs on top of a FB Page).
 */
export async function POST(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const text = String(body?.text || "").trim();
  const imageUrl = body?.image_url ? String(body.image_url) : null;
  if (!imageUrl) {
    return NextResponse.json(
      { error: "Instagram requires an image — attach one or generate with AI." },
      { status: 400 }
    );
  }
  if (!/^https:\/\//i.test(imageUrl)) {
    return NextResponse.json(
      { error: "Instagram image must be a public https URL (not a local blob). Upload to cloud storage first." },
      { status: 400 }
    );
  }

  // Resolve IG user id from the currently-selected FB Page.
  const [rows] = await db.execute(
    `SELECT selected_page_id, page_access_token, page_ids
       FROM social_accounts
      WHERE user_id = ? AND provider = 'facebook'
      LIMIT 1`,
    [session.id]
  );
  const row = (rows as any[])[0];
  if (!row?.selected_page_id || !row?.page_access_token) {
    return NextResponse.json({ error: "Connect Facebook (with IG linked) first" }, { status: 400 });
  }
  let pages: any[] = [];
  try {
    pages = typeof row.page_ids === "string" ? JSON.parse(row.page_ids) : (row.page_ids ?? []);
  } catch {}
  const igId = pages.find((p) => p.id === row.selected_page_id)?.instagram_business_account_id;
  if (!igId) {
    return NextResponse.json(
      { error: "The selected Page has no Instagram Business account linked" },
      { status: 400 }
    );
  }

  // Credit charge (skip for staff).
  if (!isStaff(session.role)) {
    try {
      await db.query("CALL spend_credit(?, ?, ?, ?, ?)", [
        session.id,
        PRICE_PER_POST,
        "debit",
        `ig_post:${Date.now()}`,
        "Post to Instagram",
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

  const pageToken = row.page_access_token;

  // Step 1: create media container
  const createResp = await fetch(
    `https://graph.facebook.com/${FB_VERSION}/${igId}/media`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        image_url: imageUrl,
        caption: text,
        access_token: pageToken,
      }).toString(),
    }
  );
  const createJson: any = await createResp.json().catch(() => ({}));
  if (!createResp.ok || !createJson?.id) {
    return NextResponse.json(
      { error: createJson?.error?.message || "Failed to create IG media container" },
      { status: 502 }
    );
  }

  // Step 2: publish container
  const pubResp = await fetch(
    `https://graph.facebook.com/${FB_VERSION}/${igId}/media_publish`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        creation_id: createJson.id,
        access_token: pageToken,
      }).toString(),
    }
  );
  const pubJson: any = await pubResp.json().catch(() => ({}));
  if (!pubResp.ok || !pubJson?.id) {
    return NextResponse.json(
      { error: pubJson?.error?.message || "Failed to publish IG post" },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true, id: pubJson.id });
}
