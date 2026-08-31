import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
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
  SigningCertURL?: string;
  SigningCertUrl?: string;
  UnsubscribeURL?: string;
  SubscribeURL?: string;
};

// ---------------------------------------------------------------------------
// SNS signature verification
//
// This endpoint has to be public — SNS posts to it unauthenticated. Until now
// it trusted the body outright, so anyone who found the URL could POST a
// forged "Bounce" and blacklist a real customer's address, or a forged
// "Delivery" that marks a bounced address as fine. Both corrupt exactly the
// numbers this endpoint exists to keep honest.
//
// Set SNS_VERIFY_SIGNATURE=false only to debug locally with hand-made curl
// payloads; leave it on everywhere else.
// ---------------------------------------------------------------------------

/** Field order AWS specifies for the signed string, per message type. */
const SIGNED_FIELDS: Record<string, string[]> = {
  Notification: ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"],
  SubscriptionConfirmation: ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"],
  UnsubscribeConfirmation: ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"],
};

/** Certificates may only be fetched from an AWS SNS host — never an attacker URL. */
function isAwsCertUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return (
      u.protocol === "https:" &&
      /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/i.test(u.hostname) &&
      u.pathname.endsWith(".pem")
    );
  } catch {
    return false;
  }
}

const certCache = new Map<string, string>();
async function fetchCert(url: string): Promise<string> {
  const hit = certCache.get(url);
  if (hit) return hit;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`cert fetch failed: HTTP ${res.status}`);
  const pem = await res.text();
  certCache.set(url, pem);
  return pem;
}

async function verifySns(body: SnsEnvelope): Promise<{ ok: boolean; error?: string }> {
  if (String(process.env.SNS_VERIFY_SIGNATURE || "").toLowerCase() === "false") {
    return { ok: true };
  }

  // When SNS_TOPIC_ARN is configured, only that topic is accepted — a valid
  // signature from someone else's SNS topic is still not ours.
  const expectedArn = process.env.SNS_TOPIC_ARN;
  if (expectedArn && body.TopicArn !== expectedArn) {
    return { ok: false, error: `unexpected TopicArn ${body.TopicArn}` };
  }

  const fields = SIGNED_FIELDS[body.Type];
  if (!fields) return { ok: false, error: `unknown message type ${body.Type}` };

  const certUrl = body.SigningCertURL || body.SigningCertUrl || "";
  if (!isAwsCertUrl(certUrl)) return { ok: false, error: "SigningCertURL is not an AWS SNS URL" };

  // Signature version 1 is SHA1, version 2 is SHA256. Anything else is not SNS.
  const algo = body.SignatureVersion === "2" ? "RSA-SHA256"
    : body.SignatureVersion === "1" ? "RSA-SHA1"
    : null;
  if (!algo) return { ok: false, error: `unsupported SignatureVersion ${body.SignatureVersion}` };

  let stringToSign = "";
  for (const f of fields) {
    const v = (body as any)[f];
    // Optional fields (Subject) are omitted entirely when absent, not blanked.
    if (v === undefined || v === null) continue;
    stringToSign += `${f}\n${v}\n`;
  }

  try {
    const pem = await fetchCert(certUrl);
    const verifier = crypto.createVerify(algo);
    verifier.update(stringToSign, "utf8");
    const ok = verifier.verify(pem, body.Signature, "base64");
    return ok ? { ok: true } : { ok: false, error: "signature mismatch" };
  } catch (e: any) {
    return { ok: false, error: e?.message || "verification failed" };
  }
}

export async function POST(req: NextRequest) {
  const hdrType = req.headers.get("x-amz-sns-message-type") as SnsEnvelope["Type"] | null;
  const body = (await req.json().catch(() => null)) as SnsEnvelope | null;
  if (!body) return NextResponse.json({ ok: false, error: "bad body" }, { status: 400 });

  // Trust the envelope's own Type over the header — the header is advisory and
  // the signature is computed over the body.
  const msgType = body.Type || hdrType;

  const sig = await verifySns({ ...body, Type: msgType as SnsEnvelope["Type"] });
  if (!sig.ok) {
    console.error("SNS signature rejected:", sig.error);
    return NextResponse.json({ ok: false, error: "invalid signature" }, { status: 403 });
  }

  if (msgType === "SubscriptionConfirmation" && body.SubscribeURL) {
    // Only ever confirm to an AWS SNS endpoint.
    if (!isAwsCertUrl((body.SigningCertURL || body.SigningCertUrl) ?? "")) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    try {
      await fetch(body.SubscribeURL);
    } catch (e) {
      console.error("SNS subscribe confirm failed", e);
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    return NextResponse.json({ ok: true, subscribed: true });
  }

  if (msgType !== "Notification") {
    return NextResponse.json({ ok: true });
  }

  try {
    const msg = JSON.parse(body.Message);

    const eventType: string =
      msg.notificationType || msg.eventType || msg.event?.eventType || "Unknown";

    const mail = msg.mail || msg.mailObject || {};
    const messageId: string | undefined = mail.messageId;

    // Recipient email — used for the suppressions INSERT below.  SES gives us
    // this in mail.destination[0] (notifications) or via the event payload.
    const recipientEmail: string | undefined =
      msg.bounce?.bouncedRecipients?.[0]?.emailAddress ||
      msg.complaint?.complainedRecipients?.[0]?.emailAddress ||
      (Array.isArray(mail.destination) ? mail.destination[0] : undefined);

    // Build the SET clause based on event type.
    const sets: string[] = ["last_event_at = NOW()"];
    const setParams: any[] = [];
    let suppressionReason: "bounce" | "complaint" | null = null;
    let eventKind = "";
    let diagnostic = "";

    if (eventType === "Delivery") {
      sets.push("status = 'delivered'");
      eventKind = "delivery";
    } else if (eventType === "Bounce") {
      const bounceType = msg.bounce?.bounceType;
      const bounceSubType = msg.bounce?.bounceSubType;
      diagnostic = [
        `SES bounce: ${bounceType || "?"}`,
        bounceSubType ? `(${bounceSubType})` : "",
        msg.bounce?.bouncedRecipients?.[0]?.diagnosticCode || "",
      ].filter(Boolean).join(" ").trim();

      sets.push("status = 'bounced'", "bounced_at = NOW()", "error_reason = ?");
      setParams.push(diagnostic.slice(0, 500));
      eventKind = "bounce";

      // Auto-suppress on PERMANENT bounces.  Transient (soft) bounces don't
      // poison the list — they retry naturally.
      //
      // 'Suppressed' / 'OnAccountSuppressionList' arrive with bounceType
      // 'Permanent' in AWS's docs, but SES has shipped them under
      // 'Undetermined' too. Both mean SES itself already refuses this address,
      // so every future send is a guaranteed bounce — matching only on
      // bounceType let those through, and they were the ones that bounced over
      // and over.
      const permanentSubType =
        bounceSubType === "Suppressed" || bounceSubType === "OnAccountSuppressionList";
      if (bounceType === "Permanent" || permanentSubType) suppressionReason = "bounce";
    } else if (eventType === "Complaint") {
      diagnostic = `SES complaint: ${msg.complaint?.complaintFeedbackType || "spam report"}`;
      sets.push("status = 'complained'", "complaint_at = NOW()", "error_reason = ?");
      setParams.push(diagnostic.slice(0, 500));
      eventKind = "complaint";
      // Spam complaints always count — Gmail/Yahoo penalize fast on these.
      suppressionReason = "complaint";
    } else if (eventType === "Reject") {
      // SES accepted the API call then refused to send (usually because the
      // address is already on the account suppression list). Nothing was
      // delivered, so leaving the row on 'sent' overstated delivery.
      diagnostic = `SES rejected the message: ${msg.reject?.reason || "unknown reason"}`;
      sets.push("status = 'failed'", "error_reason = ?");
      setParams.push(diagnostic.slice(0, 500));
      eventKind = "reject";
      // A reject for an address SES already suppressed is a permanent failure.
      if (/suppress/i.test(String(msg.reject?.reason || ""))) suppressionReason = "bounce";
    } else if (eventType === "Open") {
      sets.push(
        "opens_count = opens_count + 1",
        "opened_at = COALESCE(opened_at, NOW())",
        "status = CASE WHEN status IN ('queued','sent','delivered') THEN 'opened' ELSE status END"
      );
      eventKind = "open";
    } else if (eventType === "Click") {
      sets.push(
        "clicks_count = clicks_count + 1",
        "clicked_at = COALESCE(clicked_at, NOW())",
        "status = CASE WHEN status IN ('queued','sent','delivered','opened') THEN 'clicked' ELSE status END"
      );
      eventKind = "click";
    } else {
      // Send / DeliveryDelay / Subscription / RenderingFailure — nothing to change.
      return NextResponse.json({ ok: true, ignored: eventType });
    }

    let updated = false;
    let recipientRowId: string | null = null;
    let campaignOwnerId: string | null = null;

    const applyTo = async (rowId: string) => {
      const [res] = await db.execute(
        `UPDATE campaign_recipients SET ${sets.join(", ")} WHERE id = ?`,
        [...setParams, rowId]
      );
      return ((res as any)?.affectedRows ?? 0) > 0;
    };

    // 1. Match on the SES message id we stored at send time. Most reliable.
    if (messageId) {
      const [ownerRows] = await db.execute(
        `SELECT cr.id, c.user_id
           FROM campaign_recipients cr
           JOIN campaigns c ON c.id = cr.campaign_id
          WHERE cr.message_id = ?
          LIMIT 1`,
        [messageId]
      );
      const owner = (ownerRows as any[])[0];
      if (owner) {
        campaignOwnerId = owner.user_id;
        recipientRowId = owner.id;
        updated = await applyTo(owner.id);
      }
    }

    // 2. Fall back to the SES message tags we attach on send (campaign_id +
    //    tracking_token). These pin the event to one exact recipient row.
    if (!updated) {
      const tags = mail.tags ?? {};
      const campaignId = first(tags.campaign_id);
      const trackingToken = first(tags.tracking_token);
      if (campaignId && trackingToken) {
        const [tagRows] = await db.execute(
          `SELECT cr.id, c.user_id
             FROM campaign_recipients cr
             JOIN campaigns c ON c.id = cr.campaign_id
            WHERE cr.campaign_id = ? AND cr.tracking_token = ?
            LIMIT 1`,
          [campaignId, trackingToken]
        );
        const owner = (tagRows as any[])[0];
        if (owner) {
          campaignOwnerId = owner.user_id;
          recipientRowId = owner.id;
          updated = await applyTo(owner.id);
        }
      }
    }

    // 3. Last resort: match on the recipient address.
    //
    //    One SES event == ONE send, so this flips exactly ONE row: the most
    //    recent one still in a pre-failure state. Scoping matters here — the
    //    previous version claimed to scope by owner but the SQL had no such
    //    filter, so a bounce could flip a different tenant's row. We derive the
    //    tenant from the envelope sender (mail.source) and only fall back to an
    //    unscoped match when that cannot be resolved.
    if (!updated && recipientEmail) {
      const email = String(recipientEmail).toLowerCase();
      const senderOwnerId = await ownerOfSender(mail.source || mail.from);

      const scope = senderOwnerId ? "AND c.user_id = ?" : "";
      const scopeParams = senderOwnerId ? [senderOwnerId] : [];

      const [ownerRows] = await db.execute(
        `SELECT cr.id, c.user_id
           FROM campaign_recipients cr
           JOIN campaigns c ON c.id = cr.campaign_id
          WHERE LOWER(cr.email) = ?
            ${scope}
            AND cr.status IN ('sent', 'delivered', 'opened', 'clicked')
          ORDER BY cr.last_event_at DESC, cr.id DESC
          LIMIT 1`,
        [email, ...scopeParams]
      );
      const owner = (ownerRows as any[])[0];
      if (owner) {
        campaignOwnerId = owner.user_id;
        recipientRowId = owner.id;
        updated = await applyTo(owner.id);
      } else {
        // No open row to flip (already bounced, or the send predates tracking).
        // Still resolve an owner so the suppression below is recorded — that is
        // the part that stops the address being mailed again.
        const [anyRows] = await db.execute(
          `SELECT c.user_id
             FROM campaign_recipients cr
             JOIN campaigns c ON c.id = cr.campaign_id
            WHERE LOWER(cr.email) = ?
              ${scope}
            ORDER BY cr.id DESC
            LIMIT 1`,
          [email, ...scopeParams]
        );
        campaignOwnerId = (anyRows as any[])[0]?.user_id ?? senderOwnerId ?? null;
      }
    }

    // Event history, so the tracking page can show what happened and when.
    if (recipientRowId && eventKind) {
      await db.execute(
        `INSERT INTO campaign_events (campaign_id, recipient_id, kind, meta)
         SELECT campaign_id, id, ?, JSON_OBJECT('detail', ?, 'message_id', ?)
           FROM campaign_recipients WHERE id = ?`,
        [eventKind, diagnostic || eventType, messageId || "", recipientRowId]
      ).catch(() => {});
    }

    // Auto-add to suppressions on permanent bounce / any complaint.
    //
    // ON DUPLICATE KEY UPDATE rather than INSERT IGNORE: if the address is
    // already on the list but was marked "corrected" (an operator decided the
    // mailbox was fixed), IGNORE left it corrected — loadSuppressionSet skips
    // corrected rows, so the address stayed mailable and bounced again on every
    // campaign forever. A fresh permanent bounce is proof the correction was
    // wrong, so it un-corrects the row and refreshes the reason.
    if (suppressionReason && campaignOwnerId && recipientEmail) {
      await db.execute(
        `INSERT INTO suppressions (user_id, type, value, reason, source)
              VALUES (?, 'email', ?, ?, ?)
         ON DUPLICATE KEY UPDATE
              reason       = VALUES(reason),
              source       = VALUES(source),
              corrected    = 0,
              corrected_at = NULL,
              updated_at   = NOW()`,
        [
          campaignOwnerId,
          String(recipientEmail).toLowerCase(),
          (diagnostic || `SES ${suppressionReason} notification (msg ${messageId || "?"})`).slice(0, 255),
          suppressionReason,
        ]
      );
    }

    return NextResponse.json({ ok: true, event: eventType, matched: updated });
  } catch (e) {
    console.error("SNS notification handling failed", e);
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}

/**
 * Which account owns the address SES sent this message from?
 *
 * Used to scope the address-based fallback so one tenant's bounce can never
 * flip another tenant's recipient row. Checks verified sender identities first,
 * then any campaign that has sent from the address.
 */
async function ownerOfSender(source?: string | null): Promise<string | null> {
  const addr = extractAddress(source);
  if (!addr) return null;
  try {
    const [idRows] = await db.execute(
      "SELECT user_id FROM email_identities WHERE LOWER(email) = ? LIMIT 1",
      [addr]
    );
    const owner = (idRows as any[])[0]?.user_id;
    if (owner) return owner;
  } catch {
    /* email_identities may not exist on older installs — fall through */
  }
  const [campRows] = await db.execute(
    "SELECT user_id FROM campaigns WHERE LOWER(from_email) = ? ORDER BY created_at DESC LIMIT 1",
    [addr]
  );
  return (campRows as any[])[0]?.user_id ?? null;
}

/** "Name <a@b.com>" | "a@b.com" -> "a@b.com" (lower-cased). */
function extractAddress(raw?: string | null): string | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  const angled = s.match(/<([^>]+)>/);
  const addr = (angled ? angled[1] : s).trim().toLowerCase();
  return addr.includes("@") ? addr : null;
}

function first(x?: any): string | undefined {
  if (!x) return undefined;
  if (Array.isArray(x)) return x[0];
  return x;
}
