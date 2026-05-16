import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const AUTHZ = "https://www.linkedin.com/oauth/v2/authorization";
// "openid profile email" gets us the userinfo endpoint; w_member_social lets us post.
const SCOPES = ["openid", "profile", "email", "w_member_social"];

function appBase(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    "http://localhost:3000"
  );
}

export async function GET() {
  const session = await getUser();
  if (!session) {
    // Bounce to sign-in then back to here
    return NextResponse.redirect(
      `${appBase()}/auth/signin?next=${encodeURIComponent("/portal/multi-channel")}`
    );
  }

  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const redirectUri =
    process.env.LINKEDIN_REDIRECT_URI || `${appBase()}/api/linkedin/callback`;
  if (!clientId) {
    return NextResponse.json(
      { error: "LINKEDIN_CLIENT_ID is not set" },
      { status: 500 }
    );
  }

  // Store CSRF state tied to this user.  Auto-expires by `created_at` (we
  // garbage-collect rows older than 10 min on every authorize call).
  const state = randomUUID();
  await db.execute(
    "DELETE FROM social_oauth_states WHERE created_at < (NOW() - INTERVAL 10 MINUTE)"
  );
  await db.execute(
    `INSERT INTO social_oauth_states (state, user_id, provider) VALUES (?, ?, 'linkedin')`,
    [state, session.id]
  );

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: SCOPES.join(" "),
    state,
  });
  return NextResponse.redirect(`${AUTHZ}?${params.toString()}`);
}
