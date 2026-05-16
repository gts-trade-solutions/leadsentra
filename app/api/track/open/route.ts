import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// 1x1 transparent PNG (inline)
const PNG_1PX = Uint8Array.from([
  0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0x00,0x00,0x00,0x0d,0x49,0x48,0x44,0x52,
  0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x01,0x08,0x06,0x00,0x00,0x00,0x1f,0x15,0xc4,
  0x89,0x00,0x00,0x00,0x0a,0x49,0x44,0x41,0x54,0x78,0x9c,0x63,0xf8,0xcf,0xc0,0x00,
  0x00,0x03,0x01,0x01,0x00,0x18,0xdd,0x8d,0x07,0x00,0x00,0x00,0x00,0x49,0x45,0x4e,
  0x44,0xae,0x42,0x60,0x82,
]);

const PNG_HEADERS = {
  "Content-Type": "image/png",
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache",
  Expires: "0",
  "Content-Disposition": "inline; filename=px.png",
};

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const c = searchParams.get("c");
  const t = searchParams.get("t");

  if (c && t) {
    try {
      await db.execute(
        `UPDATE campaign_recipients
            SET opens_count   = opens_count + 1,
                opened_at     = COALESCE(opened_at, NOW()),
                last_event_at = NOW(),
                status        = CASE
                                  WHEN status IN ('queued','sent','delivered')
                                    THEN 'opened'
                                  ELSE status
                                END
          WHERE campaign_id = ? AND tracking_token = ?`,
        [c, t]
      );
      await db.execute(
        `INSERT INTO campaign_events (campaign_id, recipient_id, kind)
         SELECT campaign_id, id, 'open' FROM campaign_recipients
          WHERE campaign_id = ? AND tracking_token = ?`,
        [c, t]
      ).catch(() => {});
    } catch (e) {
      console.error("track/open failed", e);
    }
  }

  return new NextResponse(PNG_1PX, { headers: PNG_HEADERS });
}
