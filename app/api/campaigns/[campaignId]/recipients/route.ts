import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { campaignId: string } }
) {
  const session = await getUser();
  if (!session) return NextResponse.json({ recipients: [] }, { status: 401 });

  const [own] = await db.execute(
    "SELECT id FROM campaigns WHERE id = ? AND user_id = ? LIMIT 1",
    [params.campaignId, session.id]
  );
  if (!(own as any[]).length) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [rows] = await db.execute(
    `SELECT cr.id, cr.campaign_id, cr.contact_id, cr.email, cr.status, cr.message_id,
            cr.created_at AS sent_at, cr.opened_at, cr.clicked_at, cr.last_event_at,
            cr.opens_count, cr.clicks_count,
            c.contact_name
       FROM campaign_recipients cr
       LEFT JOIN contacts c ON c.id = cr.contact_id
      WHERE cr.campaign_id = ?
      ORDER BY cr.created_at DESC`,
    [params.campaignId]
  );
  return NextResponse.json({ recipients: rows });
}
