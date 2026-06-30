import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ResendEvent = {
  type: string; // e.g. "email.delivered", "email.bounced"
  data: any;
};

export async function POST(req: Request) {
  try {
    const evt = (await req.json()) as ResendEvent;

    const type = evt?.type;
    const msg = evt?.data;
    const providerId: string | undefined = msg?.id;
    const toEmail: string | undefined = msg?.to ?? msg?.recipient;

    const statusByType: Record<string, string> = {
      "email.delivered": "delivered",
      "email.bounced": "bounced",
      "email.complained": "complained",
    };
    const newStatus = statusByType[type];
    if (!newStatus) {
      // Unknown event types are ignored but not failed (Resend retries on 4xx)
      return NextResponse.json({ ok: true, ignored: type });
    }

    const sets: string[] = ["last_event_at = NOW()", "status = ?"];
    const vals: any[] = [newStatus];
    if (type === "email.bounced") sets.push("bounced_at = NOW()");
    if (type === "email.complained") sets.push("complaint_at = NOW()");

    if (providerId) {
      vals.push(providerId);
      await db.execute(
        `UPDATE campaign_recipients SET ${sets.join(", ")} WHERE message_id = ?`,
        vals
      );
    } else if (toEmail) {
      vals.push(String(toEmail).toLowerCase());
      await db.execute(
        `UPDATE campaign_recipients SET ${sets.join(", ")} WHERE LOWER(email) = ?`,
        vals
      );
    } else {
      return NextResponse.json({ ok: false, error: "Missing id and recipient" }, { status: 400 });
    }

    // On a bounce/complaint, add the address to the owner's suppression list so
    // future campaigns skip it (mirrors the SES webhook behaviour).
    if (newStatus === "bounced" || newStatus === "complained") {
      const [ownerRows] = await db.execute(
        `SELECT c.user_id, cr.email
           FROM campaign_recipients cr
           JOIN campaigns c ON c.id = cr.campaign_id
          WHERE ${providerId ? "cr.message_id = ?" : "LOWER(cr.email) = ?"}
          ORDER BY cr.id DESC
          LIMIT 1`,
        [providerId ? providerId : String(toEmail).toLowerCase()]
      );
      const owner = (ownerRows as any[])[0];
      if (owner?.user_id && owner?.email) {
        await db.execute(
          `INSERT IGNORE INTO suppressions (user_id, type, value, reason, source)
           VALUES (?, 'email', ?, ?, ?)`,
          [
            owner.user_id,
            String(owner.email).toLowerCase(),
            `Resend ${newStatus} notification`,
            newStatus === "bounced" ? "bounce" : "complaint",
          ]
        );
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("resend webhook failed", e);
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
