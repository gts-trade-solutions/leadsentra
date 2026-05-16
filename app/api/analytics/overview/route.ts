import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeStr(v: any) { return (typeof v === "string" ? v : "").trim(); }

/**
 * Lightweight overview from data already in MySQL.
 *
 * NOTE: the original version also fetched live Facebook + Instagram graph
 * stats by calling Graph API with stored access_tokens.  Multi-channel
 * posting is currently stubbed, so we skip those calls here too — the FB/IG
 * sections will be filled in once Phase D restores social posting end-to-end.
 */
export async function GET(_req: NextRequest) {
  try {
    const user = await requireUser();

    const [draftRows] = await db.execute(
      `SELECT share_url, media_urls, status, scheduled_at
         FROM content_drafts
        WHERE user_id = ?
        LIMIT 5000`,
      [user.id]
    );
    const drafts = draftRows as any[];

    // Drafts stats
    const totalDrafts = drafts.length;
    const scheduled = drafts.filter((d) => !!d.scheduled_at).length;
    const withMedia = drafts.filter((d) => {
      try {
        const arr = typeof d.media_urls === "string" ? JSON.parse(d.media_urls) : d.media_urls;
        return Array.isArray(arr) && arr.length > 0;
      } catch {
        return false;
      }
    }).length;

    const domainCount: Record<string, number> = {};
    for (const d of drafts) {
      const u = safeStr(d.share_url);
      if (!u) continue;
      try {
        const host = new URL(u).host.replace(/^www\./, "");
        domainCount[host] = (domainCount[host] || 0) + 1;
      } catch { /* not a URL */ }
    }
    const topDomains = Object.entries(domainCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([domain, count]) => ({ domain, count }));

    // Events in last 30 days
    const [eventRows] = await db.execute(
      `SELECT event_type, provider, created_at
         FROM analytics_events
        WHERE user_id = ? AND created_at >= (NOW() - INTERVAL 30 DAY)`,
      [user.id]
    );
    const events = eventRows as any[];
    const eventSummary: Record<string, number> = {};
    for (const e of events) {
      const k = `${e.provider ?? "app"}:${e.event_type}`;
      eventSummary[k] = (eventSummary[k] || 0) + 1;
    }

    return NextResponse.json({
      ok: true,
      drafts: {
        total: totalDrafts,
        scheduled,
        with_media: withMedia,
        top_domains: topDomains,
      },
      facebook: null,
      instagram: null,
      usage_30d: eventSummary,
      note: "Live Facebook/Instagram stats return after the multi-channel restoration phase.",
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Failed" },
      { status: e?.status || 400 }
    );
  }
}
