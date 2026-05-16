import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FB_VERSION = process.env.FACEBOOK_API_VERSION || "v19.0";
const AUTHZ = `https://www.facebook.com/${FB_VERSION}/dialog/oauth`;

// Scopes needed for: list Pages, post to Pages, post to IG Business via Page,
// read page tokens.
// NOTE: only used when FACEBOOK_CONFIG_ID is NOT set (classic apps).  New apps
// using "Facebook Login for Business" pass config_id instead — the permissions
// come from the use cases configured on the Meta dashboard, not this array.
// Meta has renamed `instagram_content_publish` -> `instagram_business_content_publish`
// in the new use-cases model.
const SCOPES = [
  "pages_show_list",
  "pages_manage_posts",
  "pages_read_engagement",
  "instagram_basic",
  "instagram_business_content_publish",
  "business_management",
];

function appBase(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    "http://localhost:3000"
  );
}

export async function GET() {
  const session = await getUser();
  if (!session) {
    return NextResponse.redirect(
      `${appBase()}/auth/signin?next=${encodeURIComponent("/portal/multi-channel")}`
    );
  }

  const clientId = process.env.FACEBOOK_APP_ID;
  const redirectUri =
    process.env.FACEBOOK_REDIRECT_URI || `${appBase()}/api/facebook/callback`;
  if (!clientId) {
    return NextResponse.json(
      { error: "FACEBOOK_APP_ID is not set. Add a Facebook for Developers app and put APP_ID + APP_SECRET in .env.local." },
      { status: 500 }
    );
  }

  const state = randomUUID();
  await db.execute(
    "DELETE FROM social_oauth_states WHERE created_at < (NOW() - INTERVAL 10 MINUTE)"
  );
  await db.execute(
    `INSERT INTO social_oauth_states (state, user_id, provider) VALUES (?, ?, 'facebook')`,
    [state, session.id]
  );

  // Apps created with the new "Facebook Login for Business" model reject the
  // legacy `scope=…` parameter (Meta returns "Invalid Scopes").  Instead they
  // require a `config_id` that points to a Configuration defined in the app
  // dashboard.  We support both: if FACEBOOK_CONFIG_ID is set, use it; else
  // fall back to scopes (works for classic Facebook Login apps).
  const configId = process.env.FACEBOOK_CONFIG_ID;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
  });
  if (configId) {
    params.set("config_id", configId);
  } else {
    params.set("scope", SCOPES.join(","));
  }
  return NextResponse.redirect(`${AUTHZ}?${params.toString()}`);
}
