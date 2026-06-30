import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { getMailAccountRow, toImapConfig } from "@/lib/mailAccount";
import { listMessages } from "@/lib/imap";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/mail/responses
 *
 * The "Responses" view for offers/catalogues. Merges, per contact:
 *   - REACTIONS: opens/clicks recorded on the user's campaign recipients.
 *   - REPLIES:   inbox messages whose sender is one of those recipients
 *                (so it's a reply to something we sent).
 *
 * Reply-matching is by sender address (works with existing data). Engagement
 * shows even when no mailbox is connected; replies require a connected mailbox.
 */
export async function GET() {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // 1) Pull every recipient of the user's campaigns + their engagement.
  const [rows] = await db.execute(
    `SELECT cr.email, cr.opened_at, cr.clicked_at, cr.clicks_count, cr.status,
            ca.id AS campaign_id, ca.name AS campaign_name, ca.subject AS subject,
            ca.created_at AS sent_at
       FROM campaign_recipients cr
       JOIN campaigns ca ON ca.id = cr.campaign_id
      WHERE ca.user_id = ?`,
    [session.id]
  );

  type Entry = {
    email: string;
    opened: boolean;
    clicked: boolean;
    clicks: number;
    replied: boolean;
    reply: { uid: number; subject: string; date: string | null } | null;
    campaign: { id: string; name: string | null; subject: string | null } | null;
    lastAt: number;
    _campAt: number;
    _replyAt: number;
  };

  const byEmail = new Map<string, Entry>();
  const ms = (d: any) => (d ? new Date(d).getTime() || 0 : 0);

  for (const r of rows as any[]) {
    const email = String(r.email || "").trim().toLowerCase();
    if (!email) continue;
    let e = byEmail.get(email);
    if (!e) {
      e = {
        email, opened: false, clicked: false, clicks: 0, replied: false,
        reply: null, campaign: null, lastAt: 0, _campAt: 0, _replyAt: 0,
      };
      byEmail.set(email, e);
    }
    if (r.opened_at) e.opened = true;
    if (r.clicked_at || Number(r.clicks_count) > 0) e.clicked = true;
    e.clicks += Number(r.clicks_count || 0);

    const sentAt = ms(r.sent_at);
    if (!e.campaign || sentAt > e._campAt) {
      e.campaign = { id: r.campaign_id, name: r.campaign_name, subject: r.subject };
      e._campAt = sentAt;
    }
    const maxAct = Math.max(ms(r.opened_at), ms(r.clicked_at), sentAt);
    if (maxAct > e.lastAt) e.lastAt = maxAct;
  }

  // 2) If a mailbox is connected, find inbox replies (sender ∈ recipients).
  let mailboxConnected = false;
  let replyScanError: string | null = null;
  const acct = await getMailAccountRow(session.id);
  if (acct && byEmail.size > 0) {
    mailboxConnected = true;
    try {
      const msgs = await listMessages(toImapConfig(acct), { mailbox: "INBOX", limit: 200 });
      for (const m of msgs as any[]) {
        const from = String(m.fromAddress || "").trim().toLowerCase();
        const e = byEmail.get(from);
        if (!e) continue;
        const t = ms(m.date);
        if (!e.replied || t > e._replyAt) {
          e.replied = true;
          e.reply = { uid: Number(m.uid), subject: m.subject || "(no subject)", date: m.date ?? null };
          e._replyAt = t;
          if (t > e.lastAt) e.lastAt = t;
        }
      }
    } catch (err: any) {
      replyScanError = err?.message || "Could not scan inbox for replies";
    }
  }

  // 3) Keep contacts that reacted or replied; newest activity first.
  const responses = Array.from(byEmail.values())
    .filter((e) => e.opened || e.clicked || e.replied)
    .map((e) => ({
      email: e.email,
      opened: e.opened,
      clicked: e.clicked,
      clicks: e.clicks,
      replied: e.replied,
      reply: e.reply,
      campaign: e.campaign,
      last_at: e.lastAt ? new Date(e.lastAt).toISOString() : null,
    }))
    .sort((a, b) => (b.last_at || "").localeCompare(a.last_at || ""));

  return NextResponse.json({
    responses,
    total: responses.length,
    mailboxConnected,
    replyScanError,
  });
}
