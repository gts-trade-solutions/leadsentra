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
      vals.push(toEmail);
      await db.execute(
        `UPDATE campaign_recipients SET ${sets.join(", ")} WHERE email = ?`,
        vals
      );
    } else {
      return NextResponse.json({ ok: false, error: "Missing id and recipient" }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("resend webhook failed", e);
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}
