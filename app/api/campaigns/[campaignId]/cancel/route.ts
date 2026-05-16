import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { isStaff } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/campaigns/[campaignId]/cancel
 *
 * Marks all remaining 'queued' recipients as 'failed' so the drain loop
 * stops.  Sets the campaign to 'failed' if anything was left to cancel,
 * else 'sent' (everything was already delivered).
 */
export async function POST(
  _req: Request,
  { params }: { params: { campaignId: string } }
) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const staffBypass = isStaff(session.role);

  // Permission check.
  const [cRows] = await db.execute(
    `SELECT id FROM campaigns
      WHERE id = ?
        ${staffBypass ? "" : "AND user_id = ?"}
      LIMIT 1`,
    staffBypass ? [params.campaignId] : [params.campaignId, session.id]
  );
  if (!(cRows as any[]).length) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Flip remaining queued rows.
  const [res] = await db.execute(
    `UPDATE campaign_recipients
        SET status = 'failed', last_event_at = NOW()
      WHERE campaign_id = ? AND status = 'queued'`,
    [params.campaignId]
  );
  const cancelled = (res as any)?.affectedRows ?? 0;

  // If anything remained, the campaign is effectively partially-failed.
  // Otherwise it had already finished; mark it 'sent'.
  await db.execute(
    `UPDATE campaigns
        SET status = ?, updated_at = NOW()
      WHERE id = ?`,
    [cancelled > 0 ? "failed" : "sent", params.campaignId]
  );

  return NextResponse.json({ ok: true, cancelled });
}
