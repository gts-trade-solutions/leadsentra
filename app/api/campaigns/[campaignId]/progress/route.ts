import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { isStaff } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/campaigns/[campaignId]/progress
 *
 * Lightweight counters for the floating job widget.  Called every ~2s while
 * a send is draining.  One COUNT(*) per status, plus the campaign's name/status.
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
    `SELECT status, COUNT(*) AS n
       FROM campaign_recipients
      WHERE campaign_id = ?
      GROUP BY status`,
    [params.campaignId]
  );
  const counts: Record<string, number> = { queued: 0, sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, complained: 0, suppressed: 0, failed: 0 };
  for (const r of statusRows as any[]) counts[r.status] = Number(r.n || 0);

  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const processed =
    counts.delivered + counts.opened + counts.clicked +
    counts.bounced + counts.complained + counts.failed + counts.sent;
  const queued = counts.queued;
  const failed = counts.failed + counts.bounced + counts.complained;

  return NextResponse.json({
    id: campaign.id,
    name: campaign.name,
    status: campaign.status,
    total,
    queued,
    processed,
    delivered: counts.delivered + counts.opened + counts.clicked,
    failed,
    suppressed: counts.suppressed,
  });
}
