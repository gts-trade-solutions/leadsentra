import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ metrics: {} }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter(Boolean) : [];
  if (!ids.length) return NextResponse.json({ metrics: {} });

  const placeholders = ids.map(() => "?").join(",");
  const [rows] = await db.execute(
    `SELECT campaign_id, status, opens_count, clicks_count, opened_at
       FROM campaign_recipients
      WHERE campaign_id IN (${placeholders})`,
    ids
  );

  const agg: Record<string, any> = {};
  for (const id of ids) {
    agg[id] = {
      campaign_id: id,
      recipients: 0, queued: 0, delivered: 0, bounced: 0,
      opened_unique: 0, clicks_total: 0, opens_total: 0,
    };
  }
  for (const r of rows as any[]) {
    const a = agg[r.campaign_id];
    if (!a) continue;
    a.recipients++;
    if (r.status === "queued") a.queued++;
    // "delivered" here means "successfully handed to the provider" — sent,
    // delivered, opened, clicked all count. Bounced/complained are failures.
    if (["sent", "delivered", "opened", "clicked"].includes(r.status)) a.delivered++;
    if (r.status === "bounced" || r.status === "complained") a.bounced++;
    a.opens_total += Number(r.opens_count || 0);
    a.clicks_total += Number(r.clicks_count || 0);
    if (r.opened_at) a.opened_unique++;
  }
  return NextResponse.json({ metrics: agg });
}
