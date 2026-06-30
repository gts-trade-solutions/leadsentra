import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SnsEnvelope = {
  Type: "SubscriptionConfirmation" | "Notification" | "UnsubscribeConfirmation";
  MessageId: string;
  Token?: string;
  TopicArn: string;
  Subject?: string | null;
  Message: string;
  Timestamp: string;
  SignatureVersion: string;
  Signature: string;
  SigningCertURL: string;
  UnsubscribeURL?: string;
  SubscribeURL?: string;
};

export async function POST(req: NextRequest) {
  const hdrType = req.headers.get("x-amz-sns-message-type") as SnsEnvelope["Type"] | null;
  const body = (await req.json()) as SnsEnvelope;

  // TODO: verify SNS signature in production (sns-validator package).

  if (hdrType === "SubscriptionConfirmation" && body.SubscribeURL) {
    try {
      await fetch(body.SubscribeURL);
    } catch (e) {
      console.error("SNS subscribe confirm failed", e);
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    return NextResponse.json({ ok: true, subscribed: true });
  }

  if (hdrType !== "Notification") {
    return NextResponse.json({ ok: true });
  }

  try {
    const msg = JSON.parse(body.Message);

    const eventType: string =
      msg.notificationType || msg.eventType || msg.event?.eventType || "Unknown";

    const mail = msg.mail || msg.mailObject || {};
    const messageId: string | undefined = mail.messageId;

    // Recipient email — used for the suppressions INSERT below.  SES gives us
    // this in mail.destination[0] (notifications) or via tags.
    const recipientEmail: string | undefined =
      (Array.isArray(mail.destination) ? mail.destination[0] : undefined) ||
      msg.bounce?.bouncedRecipients?.[0]?.emailAddress ||
      msg.complaint?.complainedRecipients?.[0]?.emailAddress;

    // Build the SET clause based on event type
    const sets: string[] = ["last_event_at = NOW()"];
    let suppressionReason: "bounce" | "complaint" | null = null;
    if (eventType === "Delivery") {
      sets.push("status = 'delivered'");
    } else if (eventType === "Bounce") {
      sets.push("status = 'bounced'", "bounced_at = NOW()");
      // Auto-suppress on PERMANENT bounces only.  Transient (soft) bounces
      // shouldn't poison the suppression list — they'll retry naturally.
      const bounceType = msg.bounce?.bounceType;
      if (bounceType === "Permanent") suppressionReason = "bounce";
    } else if (eventType === "Complaint") {
      sets.push("status = 'complained'", "complaint_at = NOW()");
      // Spam complaints always count — Gmail/Yahoo penalize fast on these.
      suppressionReason = "complaint";
    } else {
      return NextResponse.json({ ok: true, ignored: eventType });
    }

    let updated = false;
    let campaignOwnerId: string | null = null;

    if (messageId) {
      // Find which user owns this campaign — we need it for the multi-tenant
      // suppressions row.
      const [ownerRows] = await db.execute(
        `SELECT c.user_id, cr.email
           FROM campaign_recipients cr
           JOIN campaigns c ON c.id = cr.campaign_id
          WHERE cr.message_id = ?
          LIMIT 1`,
        [messageId]
      );
      const owner = (ownerRows as any[])[0];
      if (owner) campaignOwnerId = owner.user_id;

      const [res] = await db.execute(
        `UPDATE campaign_recipients SET ${sets.join(", ")} WHERE message_id = ?`,
        [messageId]
      );
      const affected = (res as any)?.affectedRows ?? 0;
      if (affected > 0) updated = true;
    }

    // Fallback: SES tags carry campaign_id + tracking_token (if you set them on send)
    if (!updated) {
      const tags = mail.tags ?? {};
      const campaignId = first(tags.campaign_id);
      const trackingToken = first(tags.tracking_token);
      if (campaignId && trackingToken) {
        const [ownerRows] = await db.execute(
          "SELECT user_id FROM campaigns WHERE id = ? LIMIT 1",
          [campaignId]
        );
        const owner = (ownerRows as any[])[0];
        if (owner) campaignOwnerId = owner.user_id;

        await db.execute(
          `UPDATE campaign_recipients
              SET ${sets.join(", ")}
            WHERE campaign_id = ? AND tracking_token = ?`,
          [campaignId, trackingToken]
        );
      }
    }

    // Final fallback: match purely by recipient email. Many older rows have no
    // stored message_id (or were sent via a provider that didn't return one),
    // so without this a real bounce can never flip the row off "sent" and the
    // failure shows as if it went through. A hard bounce means the mailbox is
    // dead everywhere, so updating every row for that address is correct.
    if (!updated && recipientEmail) {
      const [ownerRows] = await db.execute(
        `SELECT c.user_id
           FROM campaign_recipients cr
           JOIN campaigns c ON c.id = cr.campaign_id
          WHERE cr.email = ?
          ORDER BY cr.id DESC
          LIMIT 1`,
        [String(recipientEmail).toLowerCase()]
      );
      const owner = (ownerRows as any[])[0];
      if (owner) campaignOwnerId = owner.user_id;
      const [res2] = await db.execute(
        `UPDATE campaign_recipients SET ${sets.join(", ")} WHERE LOWER(email) = ?`,
        [String(recipientEmail).toLowerCase()]
      );
      if (((res2 as any)?.affectedRows ?? 0) > 0) updated = true;
    }

    // Auto-add to suppressions on permanent bounce / any complaint.
    // INSERT IGNORE so repeated SNS deliveries don't error.
    if (suppressionReason && campaignOwnerId && recipientEmail) {
      await db.execute(
        `INSERT IGNORE INTO suppressions (user_id, type, value, reason, source)
         VALUES (?, 'email', ?, ?, ?)`,
        [
          campaignOwnerId,
          String(recipientEmail).toLowerCase(),
          `SES ${suppressionReason} notification (msg ${messageId || "?"})`,
          suppressionReason,
        ]
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("SNS notification handling failed", e);
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}

function first(x?: any): string | undefined {
  if (!x) return undefined;
  if (Array.isArray(x)) return x[0];
  return x;
}
