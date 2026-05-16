import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FB_VERSION = process.env.FACEBOOK_API_VERSION || "v19.0";

function appBase(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    "http://localhost:3000"
  );
}

function backWithError(msg: string) {
  return NextResponse.redirect(
    `${appBase()}/portal/multi-channel?fb_error=${encodeURIComponent(msg)}`
  );
}

/**
 * GET /api/facebook/callback?code=…&state=…
 *
 * Exchanges the short-lived code for a user access token, upgrades to a
 * long-lived token, fetches the user's Pages, picks the first one as
 * "selected" (the UI can later switch), and stores everything in social_accounts.
 */
export async function GET(req: Request) {
  const clientId = process.env.FACEBOOK_APP_ID;
  const clientSecret = process.env.FACEBOOK_APP_SECRET;
  const redirectUri =
    process.env.FACEBOOK_REDIRECT_URI || `${appBase()}/api/facebook/callback`;
  if (!clientId || !clientSecret) {
    return backWithError("Facebook app not configured");
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return backWithError("Missing code or state");

  // Validate CSRF state → resolve user_id
  const [rows] = await db.execute(
    "SELECT user_id FROM social_oauth_states WHERE state = ? AND provider = 'facebook' LIMIT 1",
    [state]
  );
  const stateRow = (rows as any[])[0];
  if (!stateRow) return backWithError("State expired");
  const userId = stateRow.user_id as string;
  await db.execute("DELETE FROM social_oauth_states WHERE state = ?", [state]);

  // 1) Exchange code → short-lived user access token
  const tokenUrl = new URL(`https://graph.facebook.com/${FB_VERSION}/oauth/access_token`);
  tokenUrl.searchParams.set("client_id", clientId);
  tokenUrl.searchParams.set("client_secret", clientSecret);
  tokenUrl.searchParams.set("redirect_uri", redirectUri);
  tokenUrl.searchParams.set("code", code);
  const tokenResp = await fetch(tokenUrl.toString());
  const tokenJson: any = await tokenResp.json().catch(() => ({}));
  if (!tokenResp.ok || !tokenJson.access_token) {
    return backWithError(tokenJson?.error?.message || "Token exchange failed");
  }
  const shortToken = tokenJson.access_token as string;

  // 2) Upgrade to long-lived (60-day) user token.
  const llUrl = new URL(`https://graph.facebook.com/${FB_VERSION}/oauth/access_token`);
  llUrl.searchParams.set("grant_type", "fb_exchange_token");
  llUrl.searchParams.set("client_id", clientId);
  llUrl.searchParams.set("client_secret", clientSecret);
  llUrl.searchParams.set("fb_exchange_token", shortToken);
  const llResp = await fetch(llUrl.toString());
  const llJson: any = await llResp.json().catch(() => ({}));
  const longToken = (llJson?.access_token as string) || shortToken;
  const expiresInSec = Number(llJson?.expires_in || 0); // 0 means "never expires" for some grants

  // 3) Identify user
  const meResp = await fetch(
    `https://graph.facebook.com/${FB_VERSION}/me?fields=id,name&access_token=${encodeURIComponent(longToken)}`
  );
  const me: any = await meResp.json().catch(() => ({}));
  if (!meResp.ok || !me?.id) {
    return backWithError(me?.error?.message || "Failed to read user");
  }

  // 4) Get Pages this user manages.  Each Page comes with its OWN access token —
  //    that's what we use for posting (user-token can't post to a Page).
  const pagesResp = await fetch(
    `https://graph.facebook.com/${FB_VERSION}/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${encodeURIComponent(longToken)}`
  );
  const pagesJson: any = await pagesResp.json().catch(() => ({}));
  const pages: any[] = Array.isArray(pagesJson?.data) ? pagesJson.data : [];

  // Pick the first page (user can switch later via /api/facebook/pages/selected).
  const firstPage = pages[0];
  const selectedPageId = firstPage?.id ?? null;
  const selectedPageName = firstPage?.name ?? null;
  const pageAccessToken = firstPage?.access_token ?? null;

  // 5) Upsert social_accounts row.
  const expiresAt = expiresInSec > 0 ? new Date(Date.now() + expiresInSec * 1000) : null;
  const pageIdsJson = JSON.stringify(pages.map((p) => ({
    id: p.id,
    name: p.name,
    instagram_business_account_id: p.instagram_business_account?.id ?? null,
  })));

  await db.execute(
    `INSERT INTO social_accounts
       (id, user_id, provider, access_token, scope, expires_at,
        fb_user_id, page_ids, page_name, page_access_token,
        selected_page_id, selected_page_name)
     VALUES (?, ?, 'facebook', ?, ?, ?, ?, CAST(? AS JSON), ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       access_token = VALUES(access_token),
       scope = VALUES(scope),
       expires_at = VALUES(expires_at),
       fb_user_id = VALUES(fb_user_id),
       page_ids = VALUES(page_ids),
       page_name = VALUES(page_name),
       page_access_token = VALUES(page_access_token),
       selected_page_id = VALUES(selected_page_id),
       selected_page_name = VALUES(selected_page_name),
       updated_at = NOW()`,
    [
      randomUUID(),
      userId,
      longToken,
      "pages_show_list,pages_manage_posts,instagram_basic,instagram_content_publish",
      expiresAt,
      me.id,
      pageIdsJson,
      selectedPageName,
      pageAccessToken,
      selectedPageId,
      selectedPageName,
    ]
  );

  return NextResponse.redirect(`${appBase()}/portal/multi-channel?fb_connected=1`);
}
