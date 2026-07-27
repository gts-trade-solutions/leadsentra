import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { isStaff } from "@/lib/admin";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { campaignId: string } }
) {
  const session = await getUser();
  if (!session) return NextResponse.json({ recipients: [] }, { status: 401 });

  // Staff (admin/moderator) see every campaign — same rule as the global
  // tracking list and this route's siblings (progress / cancel).  Without it
  // an admin could open any campaign from Tracking and got a 404 with an
  // empty table, because the campaign belongs to another user.
  const staffBypass = isStaff(session.role);

  const [own] = await db.execute(
    `SELECT id, name, status, subject, created_at
       FROM campaigns
      WHERE id = ?
        ${staffBypass ? "" : "AND user_id = ?"}
      LIMIT 1`,
    staffBypass ? [params.campaignId] : [params.campaignId, session.id]
  );
  const campaign = (own as any[])[0];
  if (!campaign) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [rows] = await db.execute(
    `SELECT cr.id, cr.campaign_id, cr.contact_id, cr.email, cr.status, cr.message_id,
            cr.error_reason, cr.bounced_at, cr.complaint_at,
            cr.created_at AS sent_at, cr.opened_at, cr.clicked_at, cr.last_event_at,
            cr.opens_count, cr.clicks_count,
            c.contact_name
       FROM campaign_recipients cr
       LEFT JOIN contacts c ON c.id = cr.contact_id
      WHERE cr.campaign_id = ?
      ORDER BY cr.created_at DESC`,
    [params.campaignId]
  );
  // The campaign summary rides along so the page doesn't have to pull the
  // whole campaign list just to read this one's name — which also never
  // worked for staff viewing someone else's campaign.
  return NextResponse.json({ campaign, recipients: rows });
}
