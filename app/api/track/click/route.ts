import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const c = url.searchParams.get("c");
  const t = url.searchParams.get("t");
  const u = url.searchParams.get("u");

  const fallback =
    process.env.APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://example.com";
  const target = safeTarget(u, fallback) ?? fallback;

  if (c && t) {
    try {
      await db.execute(
        `UPDATE campaign_recipients
            SET clicks_count  = clicks_count + 1,
                clicked_at    = COALESCE(clicked_at, NOW()),
                last_event_at = NOW(),
                status        = CASE
                                  WHEN status IN ('queued','sent','delivered','opened')
                                    THEN 'clicked'
                                  ELSE status
                                END
          WHERE campaign_id = ? AND tracking_token = ?`,
        [c, t]
      );
      await db.execute(
        `INSERT INTO campaign_events (campaign_id, recipient_id, kind, meta)
         SELECT campaign_id, id, 'click', JSON_OBJECT('url', ?)
           FROM campaign_recipients
          WHERE campaign_id = ? AND tracking_token = ?`,
        [target, c, t]
      ).catch(() => {});
    } catch (e) {
      console.error("track/click failed", e);
    }
  }

  return NextResponse.redirect(target, { status: 302 });
}

/**
 * Resolve the click-through target.
 *
 * `u` arrives already percent-decoded (URLSearchParams.get decodes once), so we
 * must NOT decode it again — a second decodeURIComponent corrupts links whose
 * path/query legitimately contains %xx sequences (e.g. encoded spaces).
 *
 * We also accept links that aren't fully-qualified http(s) URLs instead of
 * throwing the recipient back to the home page:
 *   - "//host/path"          protocol-relative  -> https://host/path
 *   - "/reporting/india-ev"  app-relative path  -> resolved against `base`
 *   - "www.example.com/x"    scheme-less domain -> https://www.example.com/x
 * Anything we still can't make sense of returns null so the caller falls back.
 */
function safeTarget(u: string | null, base: string): string | null {
  if (!u) return null;
  const s = u.trim();
  if (!s) return null;

  // Already absolute http(s) — use as-is.
  if (/^https?:\/\//i.test(s)) return s;

  // Protocol-relative URL.
  if (s.startsWith("//")) return `https:${s}`;

  // App-relative path ("/reporting/...") — resolve against the app base URL.
  if (s.startsWith("/")) {
    try {
      return new URL(s, base).toString();
    } catch {
      return null;
    }
  }

  // Scheme-less bare domain like "www.example.com/report" or "example.com".
  // Heuristic: starts with a hostname-looking token containing a dot, followed
  // by end / slash / query / fragment.  Assume https.
  if (/^[\w-]+(\.[\w-]+)+([/?#]|$)/.test(s)) return `https://${s}`;

  // Last resort: treat as relative to the app base.
  try {
    return new URL(s, base).toString();
  } catch {
    return null;
  }
}
