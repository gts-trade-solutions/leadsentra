import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { isStaff } from "@/lib/admin";
import { emptyStats, addRow, finalizeStats, type CampaignStats } from "@/lib/campaignStats";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ metrics: {} }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter(Boolean) : [];
  if (!ids.length) return NextResponse.json({ metrics: {} });

  const placeholders = ids.map(() => "?").join(",");
  // Ownership guard: without the JOIN any signed-in user could POST another
  // tenant's campaign ids and read their send volume, open and bounce counts.
  const staffBypass = isStaff(session.role);
  const [rows] = await db.execute(
    `SELECT cr.campaign_id, cr.status, cr.opens_count, cr.clicks_count,
            cr.opened_at, cr.clicked_at
       FROM campaign_recipients cr
       JOIN campaigns c ON c.id = cr.campaign_id
      WHERE cr.campaign_id IN (${placeholders})
        ${staffBypass ? "" : "AND c.user_id = ?"}`,
    staffBypass ? ids : [...ids, session.id]
  );

  const agg: Record<string, CampaignStats> = {};
  for (const id of ids) agg[id] = emptyStats();
  for (const r of rows as any[]) {
    const a = agg[r.campaign_id];
    if (!a) continue;
    addRow(a, r);
  }
  for (const id of ids) finalizeStats(agg[id]);

  return NextResponse.json({ metrics: agg });
}
