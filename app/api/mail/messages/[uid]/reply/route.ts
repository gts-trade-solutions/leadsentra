import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { getMailAccountRow, toImapConfig } from "@/lib/mailAccount";
import { getReplyTarget, appendToSent, buildRfc822 } from "@/lib/imap";
import { sendEmail } from "@/lib/emailProvider";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/mail/messages/[uid]/reply   body: { body: string, subject?: string }
 *
 * Replies to a received message. The reply is sent FROM the connected mailbox
 * address via the configured email provider (SES/Resend), so it must be a
 * verified sender. We reply to the original sender with a "Re: ..." subject.
 */
export async function POST(req: Request, { params }: { params: { uid: string } }) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const uid = Number(params.uid);
  if (!Number.isFinite(uid)) {
    return NextResponse.json({ error: "Invalid message id" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const replyHtml = typeof body.body === "string" ? body.body : "";
  if (!replyHtml.trim()) {
    return NextResponse.json({ error: "Reply body is required" }, { status: 400 });
  }

  const row = await getMailAccountRow(session.id);
  if (!row) return NextResponse.json({ error: "No mailbox connected" }, { status: 409 });

  const cfg = toImapConfig(row);
  const mailbox = typeof body.mailbox === "string" && body.mailbox.trim() ? body.mailbox.trim() : "INBOX";

  let target;
  try {
    target = await getReplyTarget(cfg, uid, mailbox);
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Could not read the original message" },
      { status: 502 }
    );
  }
  if (!target || !target.fromAddress) {
    return NextResponse.json({ error: "Original sender not found" }, { status: 404 });
  }

  // "Re:" subject — don't double-prefix if it's already a reply.
  const baseSubject = (body.subject && String(body.subject).trim()) || target.subject || "";
  const subject = /^re:/i.test(baseSubject) ? baseSubject : `Re: ${baseSubject}`.trim();

  // Wrap the typed reply as simple HTML if it isn't already markup.
  const looksLikeHtml = /<[a-z][\s\S]*>/i.test(replyHtml);
  const html = looksLikeHtml
    ? replyHtml
    : `<div style="white-space:pre-wrap">${escapeHtml(replyHtml)}</div>`;
  const text = looksLikeHtml ? undefined : replyHtml;

  // Threading: In-Reply-To = the original Message-ID; References = the original
  // chain plus that Message-ID, so the reply joins the same conversation.
  const inReplyTo = target.messageId || undefined;
  const references = [target.references, target.messageId]
    .filter(Boolean)
    .join(" ")
    .trim() || undefined;

  let result;
  try {
    result = await sendEmail({
      to: target.fromAddress,
      subject: subject || "(no subject)",
      html,
      text,
      fromEmail: row.username,
      fromName: row.from_name || undefined,
      inReplyTo,
      references,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to send reply" },
      { status: 502 }
    );
  }

  // Save a copy to the Sent folder (best-effort — never fail the reply if the
  // server has no Sent mailbox or the append is rejected).
  let savedToSent = false;
  try {
    const raw = buildRfc822({
      fromEmail: row.username,
      fromName: row.from_name || undefined,
      to: target.fromAddress,
      subject: subject || "(no subject)",
      html,
      text,
      inReplyTo,
      references,
    });
    savedToSent = await appendToSent(cfg, raw);
  } catch {
    savedToSent = false;
  }

  return NextResponse.json({ ok: true, id: result.id, savedToSent });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
