type SendArgs = {
  to: string;
  subject: string;
  html: string;
  fromEmail: string;
  fromName?: string;
  /** Plain-text alternative — sent as the text/plain MIME part.  Cheap deliverability win. */
  text?: string;
  /** Public https URL the recipient hits to unsubscribe.  When set we attach
   *  the List-Unsubscribe + List-Unsubscribe-Post: One-Click headers required
   *  by Gmail/Yahoo for bulk senders since Feb 2024. */
  unsubscribeUrl?: string;
  /** Campaign id, surfaced in the Feedback-ID header so Gmail Postmaster
   *  Tools can break out reputation per-campaign.  Optional but recommended. */
  campaignId?: string;
};

// Free mail providers — sending FROM these domains via SES/Resend fails
// DMARC at the receiver because the From-domain doesn't match the signing
// domain.  We warn on send so the operator notices in dev console.
const FREE_PROVIDER_DOMAINS = new Set([
  "gmail.com", "googlemail.com",
  "yahoo.com", "yahoo.co.in", "yahoo.co.uk", "ymail.com",
  "outlook.com", "hotmail.com", "live.com", "msn.com",
  "aol.com", "icloud.com", "me.com",
  "protonmail.com", "proton.me",
  "rediffmail.com", "zoho.com",
]);
function isFreeProviderEmail(email: string): boolean {
  const at = email.lastIndexOf("@");
  return at >= 0 && FREE_PROVIDER_DOMAINS.has(email.slice(at + 1).toLowerCase());
}
/** Pre-send deliverability checks — log warnings so operators see what's
 *  about to land in spam.  Doesn't block the send. */
function logDeliverabilityWarnings(args: SendArgs) {
  if (isFreeProviderEmail(args.fromEmail)) {
    console.warn(
      `⚠️ [DELIVERABILITY] Sending FROM a free-provider address (${args.fromEmail}). ` +
      `Gmail/Outlook/Yahoo will spam-folder this. Use a domain you own with DKIM.`
    );
  }
  if (args.unsubscribeUrl && /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(args.unsubscribeUrl)) {
    console.warn(
      `⚠️ [DELIVERABILITY] List-Unsubscribe URL points to localhost (${args.unsubscribeUrl}). ` +
      `Gmail's one-click unsubscribe POST will fail — hurts deliverability score. ` +
      `Set NEXT_PUBLIC_APP_URL to a public URL (ngrok / deployed domain).`
    );
  }
}

export type Provider = "ses" | "resend" | "dev";

/**
 * Picks an email provider in this order:
 *   1. EMAIL_PROVIDER env var (forces a specific provider)
 *   2. RESEND_API_KEY set         → "resend"
 *   3. AWS_ACCESS_KEY_ID set      → "ses"
 *   4. otherwise                  → "dev" (logs to server console)
 */
export function resolveProvider(): Provider {
  const forced = (process.env.EMAIL_PROVIDER || "").toLowerCase();
  if (forced === "resend" || forced === "ses" || forced === "dev") return forced as Provider;
  if (process.env.RESEND_API_KEY) return "resend";
  if (process.env.AWS_ACCESS_KEY_ID) return "ses";
  return "dev";
}

export async function sendEmail(args: SendArgs): Promise<{ id: string | null }> {
  logDeliverabilityWarnings(args);
  const provider = resolveProvider();
  if (provider === "resend") return sendWithResend(args);
  if (provider === "ses") return sendWithSES(args);
  return sendWithDev(args);
}

// ---------- AWS SES v2 ----------
async function sendWithSES({ to, subject, html, fromEmail, fromName, text, unsubscribeUrl, campaignId }: SendArgs) {
  const { SESv2Client, SendEmailCommand } = await import("@aws-sdk/client-sesv2");
  const ses = new SESv2Client({
    region: process.env.SES_REGION || process.env.AWS_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });

  // Build multipart/alternative when a text body is provided — better spam score.
  const body: any = { Html: { Data: html } };
  if (text) body.Text = { Data: text };

  // SES SimpleEmail can't attach arbitrary headers, so when we need List-Unsubscribe
  // (for bulk-sender compliance) we fall back to the Raw email API.  This is the
  // recommended path per AWS docs once you go beyond a basic Html body.
  if (unsubscribeUrl) {
    const boundary = `bnd_${Math.random().toString(36).slice(2)}`;
    const fromHeader = fromName ? `${fromName} <${fromEmail}>` : fromEmail;
    // Spam filters look for a real-looking Message-ID.  Use the sender's domain
    // (or a fallback) so it's anchored to a verified identity.
    const fromDomain = (fromEmail.split("@")[1] || "leadsentra.local").toLowerCase();
    const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@${fromDomain}>`;
    const replyTo = process.env.EMAIL_REPLY_TO || fromEmail;
    // Feedback-ID: Gmail Postmaster Tools breaks down reputation per-campaign
    // using this header.  Format recommended by Google: <campaign>:<customer>:<type>:<sender>
    // Stable per campaign — helps spot which campaigns trigger complaints.
    const feedbackId = [
      campaignId ? `c-${campaignId.slice(0, 8)}` : "default",
      "leadsentra",
      "mkt",
      fromDomain.replace(/\./g, "_"),
    ].join(":");

    const lines: string[] = [];
    lines.push(`From: ${fromHeader}`);
    lines.push(`To: ${to}`);
    lines.push(`Reply-To: ${replyTo}`);
    // Sender header — for downstream relays / Gmail's "via" notice; matches From
    // when no specific sender override is set.  Some receivers expect this.
    lines.push(`Sender: ${fromEmail}`);
    lines.push(`Subject: ${encodeMimeHeader(subject)}`);
    lines.push(`Message-ID: ${messageId}`);
    lines.push(`Date: ${new Date().toUTCString()}`);
    lines.push("MIME-Version: 1.0");
    lines.push("X-Mailer: LeadSentra (Next.js + SES)");
    // Bulk-sender compliance (Gmail/Yahoo, Feb 2024+):
    lines.push(`List-Unsubscribe: <${unsubscribeUrl}>`);
    lines.push("List-Unsubscribe-Post: List-Unsubscribe=One-Click");
    // Gmail Postmaster Tools: per-campaign reputation tracking.
    lines.push(`Feedback-ID: ${feedbackId}`);
    // Precedence: bulk tells some MTAs not to send auto-replies to this mail.
    lines.push("Precedence: bulk");
    // Auto-Submitted: identify as automated bulk; suppresses out-of-office replies.
    lines.push("Auto-Submitted: auto-generated");
    if (campaignId) lines.push(`X-Entity-Ref-ID: ${campaignId}`);
    lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    lines.push("");
    if (text) {
      lines.push(`--${boundary}`);
      lines.push("Content-Type: text/plain; charset=utf-8");
      // quoted-printable handles long lines + non-ASCII safely.  7bit can
      // truncate or be rejected when a line exceeds 998 chars (RFC 5322).
      lines.push("Content-Transfer-Encoding: quoted-printable");
      lines.push("");
      lines.push(toQuotedPrintable(text));
      lines.push("");
    }
    lines.push(`--${boundary}`);
    lines.push("Content-Type: text/html; charset=utf-8");
    lines.push("Content-Transfer-Encoding: quoted-printable");
    lines.push("");
    lines.push(toQuotedPrintable(html));
    lines.push("");
    lines.push(`--${boundary}--`);
    const raw = new TextEncoder().encode(lines.join("\r\n"));

    const resp = await ses.send(
      new SendEmailCommand({
        Content: { Raw: { Data: raw } },
        ConfigurationSetName: process.env.SES_CONFIG_SET || undefined,
      })
    );
    return { id: resp.MessageId ?? null };
  }

  const resp = await ses.send(
    new SendEmailCommand({
      FromEmailAddress: fromName ? `${fromName} <${fromEmail}>` : fromEmail,
      Destination: { ToAddresses: [to] },
      Content: { Simple: { Subject: { Data: subject }, Body: body } },
      ConfigurationSetName: process.env.SES_CONFIG_SET || undefined,
    })
  );
  return { id: resp.MessageId ?? null };
}

/** RFC 2047 encoded-word for non-ASCII subject lines. */
function encodeMimeHeader(s: string): string {
  // ASCII-safe — return as-is.
  if (/^[\x20-\x7E]*$/.test(s)) return s;
  const b64 = Buffer.from(s, "utf-8").toString("base64");
  return `=?UTF-8?B?${b64}?=`;
}

/**
 * Quoted-printable encoder per RFC 2045 §6.7.
 *
 * Why we need it:
 *   - 7bit transfer encoding is limited to 998-char lines and ASCII printable
 *     bytes; emails with long lines or accented characters get rejected.
 *   - Base64 doubles the size and triggers some spam filters.
 *   - QP keeps ASCII readable (good for header scanning by spam filters) AND
 *     encodes specials/non-ASCII bytes safely.
 */
function toQuotedPrintable(input: string): string {
  const bytes = Buffer.from(input, "utf-8");
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    // Pass through printable ASCII (except `=` which is the escape char) and tab.
    if (b === 0x09 || (b >= 0x20 && b <= 0x7e && b !== 0x3d)) {
      out += String.fromCharCode(b);
    } else if (b === 0x0d && bytes[i + 1] === 0x0a) {
      // Preserve CRLF as a logical newline.
      out += "\r\n";
      i++;
    } else if (b === 0x0a) {
      out += "\r\n";
    } else {
      out += "=" + b.toString(16).toUpperCase().padStart(2, "0");
    }
  }
  // Enforce the 76-char soft line limit with `=` continuation.
  return out
    .split("\r\n")
    .map((line) => {
      const parts: string[] = [];
      let cur = "";
      for (const ch of line) {
        if (cur.length + ch.length > 75) {
          parts.push(cur + "=");
          cur = "";
        }
        cur += ch;
      }
      parts.push(cur);
      return parts.join("\r\n");
    })
    .join("\r\n");
}

// ---------- Resend ----------
async function sendWithResend({ to, subject, html, fromEmail, fromName, text, unsubscribeUrl, campaignId }: SendArgs) {
  const { Resend } = await import("resend");
  const resend = new Resend(process.env.RESEND_API_KEY!);
  const payload: any = {
    from: fromName ? `${fromName} <${fromEmail}>` : fromEmail,
    to,
    subject,
    html,
  };
  if (text) payload.text = text;
  // Reply-To improves deliverability slightly and keeps replies routed to a
  // monitored inbox.  Defaults to the sender if EMAIL_REPLY_TO isn't configured.
  payload.reply_to = process.env.EMAIL_REPLY_TO || fromEmail;

  const fromDomain = (fromEmail.split("@")[1] || "leadsentra.local").toLowerCase();
  const feedbackId = [
    campaignId ? `c-${campaignId.slice(0, 8)}` : "default",
    "leadsentra",
    "mkt",
    fromDomain.replace(/\./g, "_"),
  ].join(":");
  const headers: Record<string, string> = {
    "Precedence": "bulk",
    "X-Mailer": "LeadSentra (Next.js + Resend)",
    "Auto-Submitted": "auto-generated",
    "Feedback-ID": feedbackId,
  };
  if (unsubscribeUrl) {
    headers["List-Unsubscribe"] = `<${unsubscribeUrl}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  if (campaignId) headers["X-Entity-Ref-ID"] = campaignId;
  payload.headers = headers;

  const resp = await resend.emails.send(payload);
  if ((resp as any)?.error) {
    throw new Error(`Resend send failed: ${(resp as any).error?.message || JSON.stringify((resp as any).error)}`);
  }
  return { id: (resp as any)?.data?.id ?? (resp as any)?.id ?? null };
}

// ---------- Dev fallback ----------
// Used when no provider creds are present.  Pretends the send succeeded so
// the rest of the flow (campaign status, delivered counter, tracking) works
// end-to-end on a fresh machine.
async function sendWithDev({ to, subject, fromEmail }: SendArgs) {
  // eslint-disable-next-line no-console
  console.log(
    `[DEV email] FROM ${fromEmail}  TO ${to}\n          Subject: ${subject}\n          (Set RESEND_API_KEY or AWS_ACCESS_KEY_ID in .env.local to actually send.)`
  );
  // Fake ID so message_id is populated and webhooks can match by it later.
  const fakeId = `dev-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return { id: fakeId };
}
