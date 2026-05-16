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
  const target = safeTarget(u) ?? fallback;

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

function safeTarget(u: string | null) {
  if (!u) return null;
  try {
    const decoded = decodeURIComponent(u);
    if (!/^https?:\/\//i.test(decoded)) return null;
    return decoded;
  } catch {
    return null;
  }
}
