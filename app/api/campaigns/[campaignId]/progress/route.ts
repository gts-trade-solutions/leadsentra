import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { isStaff } from "@/lib/admin";
import { ALL_STATUSES, statsFromCounts } from "@/lib/campaignStats";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/campaigns/[campaignId]/progress
 *
 * Lightweight counters for the floating job widget.  Called every ~2s while
 * a send is draining.  One COUNT(*) per status, plus the campaign name/status.
 *
 * The numbers come from lib/campaignStats so this widget, the campaign list
 * and the tracking page cannot drift apart again.
 */
export async function GET(
  _req: Request,
  { params }: { params: { campaignId: string } }
) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const staffBypass = isStaff(session.role);

  const [cRows] = await db.execute(
    `SELECT id, user_id, name, status, recipients_count
       FROM campaigns
      WHERE id = ?
        ${staffBypass ? "" : "AND user_id = ?"}
      LIMIT 1`,
    staffBypass ? [params.campaignId] : [params.campaignId, session.id]
  );
  const campaign = (cRows as any[])[0];
  if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [statusRows] = await db.execute(
    `SELECT status, COUNT(*) AS n,
            SUM(CASE WHEN opens_count  > 0 OR opened_at  IS NOT NULL THEN 1 ELSE 0 END) AS opened_unique,
            SUM(CASE WHEN clicks_count > 0 OR clicked_at IS NOT NULL THEN 1 ELSE 0 END) AS clicked_unique,
            COALESCE(SUM(opens_count), 0)  AS opens_total,
            COALESCE(SUM(clicks_count), 0) AS clicks_total
       FROM campaign_recipients
      WHERE campaign_id = ?
      GROUP BY status`,
    [params.campaignId]
  );

  const counts: Record<string, number> = {};
  for (const s of ALL_STATUSES) counts[s] = 0;
  let openedUnique = 0, clickedUnique = 0, opensTotal = 0, clicksTotal = 0;
  for (const r of statusRows as any[]) {
    counts[r.status] = Number(r.n || 0);
    openedUnique += Number(r.opened_unique || 0);
    clickedUnique += Number(r.clicked_unique || 0);
    opensTotal += Number(r.opens_total || 0);
    clicksTotal += Number(r.clicks_total || 0);
  }

  const stats = statsFromCounts(counts, {
    opened_unique: openedUnique,
    clicked_unique: clickedUnique,
    opens_total: opensTotal,
    clicks_total: clicksTotal,
  });

  return NextResponse.json({
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    total: stats.recipients,
    queued: stats.queued,
    // Everything we already acted on — sent or skipped. Suppressed rows are
    // processed too: they were deliberately skipped, so leaving them out left
    // the widget stuck below 100% on any campaign with a suppressed address.
    processed: stats.recipients - stats.queued,
    // "Delivered" = accepted by the provider and not since failed. Previously
    // this excluded 'sent', so the widget read 0 delivered for the entire send
    // whenever delivery webhooks were not wired up.
    delivered: stats.accepted,
    confirmed: stats.confirmed,
    failed: stats.bounced + stats.complained + stats.failed,
    suppressed: stats.suppressed,
    counts,
    stats,
  });
}
