import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function appBase(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    "http://localhost:3000"
  );
}

function redirectBack(query: Record<string, string>) {
  const u = new URL("/portal/multi-channel", appBase());
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
  return NextResponse.redirect(u);
}

async function postJson(url: string, body: URLSearchParams): Promise<any> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(text);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  // LinkedIn-side error → back to portal with a banner
  const liError = searchParams.get("error");
  if (liError) {
    return redirectBack({
      li_error: liError,
      li_error_description: searchParams.get("error_description") || "",
    });
  }

  const code = searchParams.get("code") || "";
  const state = searchParams.get("state") || "";
  if (!code || !state) {
    return redirectBack({ li_error: "missing_code_or_state" });
  }

  // 1. Look up the state we issued in /api/linkedin/authorize
  const [stateRows] = await db.execute(
    `SELECT user_id, provider, created_at
       FROM social_oauth_states
      WHERE state = ?
      LIMIT 1`,
    [state]
  );
  const st = (stateRows as any[])[0];
  if (!st || st.provider !== "linkedin") {
    return redirectBack({ li_error: "invalid_state" });
  }
  if (Date.now() - new Date(st.created_at).getTime() > 10 * 60 * 1000) {
    await db.execute("DELETE FROM social_oauth_states WHERE state = ?", [state]);
    return redirectBack({ li_error: "state_expired" });
  }
  const userId = st.user_id as string;

  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  const redirectUri =
    process.env.LINKEDIN_REDIRECT_URI || `${appBase()}/api/linkedin/callback`;
  if (!clientId || !clientSecret) {
    return redirectBack({ li_error: "server_misconfigured" });
  }

  try {
    // 2. Exchange code → access_token
    const tok = await postJson(
      "https://www.linkedin.com/oauth/v2/accessToken",
      new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
      })
    );
    const access_token: string = tok.access_token;
    const expires_in: number = Number(tok.expires_in ?? 0);
    const expires_at = new Date(Date.now() + expires_in * 1000);

    // 3. OIDC userinfo → member URN
    let member_urn: string | null = null;
    try {
      const r = await fetch("https://api.linkedin.com/v2/userinfo", {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      if (r.ok) {
        const info: any = await r.json();
        if (info?.sub) member_urn = `urn:li:person:${info.sub}`;
      }
    } catch {
      /* ignore — we still have a working token */
    }

    // 4. Identity change tracker
    const [prevRows] = await db.execute(
      `SELECT member_urn FROM social_accounts
        WHERE user_id = ? AND provider = 'linkedin'
        LIMIT 1`,
      [userId]
    );
    const prevUrn = (prevRows as any[])[0]?.member_urn || null;

    // 5. Upsert social_accounts (one row per user+provider)
    const scopeRaw = typeof tok.scope === "string" ? tok.scope : "";
    const scopeStr = scopeRaw.split(/[,\s]+/).filter(Boolean).join(" ");
    const newId = randomUUID();

    await db.execute(
      `INSERT INTO social_accounts
         (id, user_id, provider, access_token, scope, expires_at, member_urn)
       VALUES (?, ?, 'linkedin', ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         access_token = VALUES(access_token),
         scope        = VALUES(scope),
         expires_at   = VALUES(expires_at),
         member_urn   = VALUES(member_urn),
         updated_at   = CURRENT_TIMESTAMP`,
      [newId, userId, access_token, scopeStr, expires_at, member_urn]
    );

    // 6. If member identity changed, bump changes_used (cap 2)
    if (member_urn && prevUrn && prevUrn !== member_urn) {
      const [usageRows] = await db.execute(
        `SELECT changes_used FROM social_connection_usage
          WHERE user_id = ? AND provider = 'linkedin' LIMIT 1`,
        [userId]
      );
      const used = Number((usageRows as any[])[0]?.changes_used ?? 0);
      if (used < 2) {
        await db.execute(
          `INSERT INTO social_connection_usage (user_id, provider, changes_used)
           VALUES (?, 'linkedin', ?)
           ON DUPLICATE KEY UPDATE
             changes_used = VALUES(changes_used),
             updated_at = CURRENT_TIMESTAMP`,
          [userId, used + 1]
        );
      }
    } else if (!prevUrn) {
      // First connect: seed the usage row at 0
      await db.execute(
        `INSERT IGNORE INTO social_connection_usage (user_id, provider, changes_used)
         VALUES (?, 'linkedin', 0)`,
        [userId]
      );
    }

    // 7. Consume the state
    await db.execute("DELETE FROM social_oauth_states WHERE state = ?", [state]);

    return redirectBack({ li_connected: "1" });
  } catch (e: any) {
    console.error("[linkedin/callback]", e);
    return redirectBack({
      li_error: "exchange_failed",
      li_error_description: e?.message || "Unknown error",
    });
  }
}
