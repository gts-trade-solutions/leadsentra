import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/social/medium/status
 *
 * Medium uses a shared integration token (Settings → Security and apps →
 * Integration tokens). No per-user OAuth.
 *
 * Required env vars:
 *   MEDIUM_INTEGRATION_TOKEN  - from Medium account settings
 *
 * Optional:
 *   MEDIUM_USER_ID            - cached numeric user id. We fetch it via
 *                               /me on first call if not set, but caching
 *                               saves one request per status check.
 */
export async function GET() {
  const session = await getUser();
  if (!session) return NextResponse.json({ connected: false }, { status: 401 });

  const token = process.env.MEDIUM_INTEGRATION_TOKEN;
  if (!token) {
    return NextResponse.json({
      connected: false,
      reason: "Medium not configured. Add MEDIUM_INTEGRATION_TOKEN to .env (get one from Medium Settings → Security and apps).",
    });
  }

  try {
    const r = await fetch("https://api.medium.com/v1/me", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok || !j?.data?.id) {
      return NextResponse.json({
        connected: false,
        reason: j?.errors?.[0]?.message || "Invalid Medium integration token",
      });
    }
    return NextResponse.json({
      connected: true,
      page_name: `@${j.data.username || j.data.name || "medium_user"}`,
      medium_user_id: j.data.id,
    });
  } catch (e: any) {
    return NextResponse.json({
      connected: false,
      reason: e?.message || "Failed to reach Medium API",
    });
  }
}
