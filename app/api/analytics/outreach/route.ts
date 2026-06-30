import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { getMailAccountRow, toImapConfig } from "@/lib/mailAccount";
import { listMessages } from "@/lib/imap";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/analytics/outreach
 *
 * Per-company outreach analytics: which companies you've sent offers/campaigns
 * to, how those performed (opened / clicked), and which companies have
 * responded. "Responded" is detected by matching the connected mailbox's
 * recent senders against the people you emailed — so it needs the Inbox
 * connected (otherwise replies show as 0).
 */
export async function GET(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const wantReplies = new URL(req.url).searchParams.get("replies") !== "0";

  // Per (company, campaign) sent rows — actually-attempted recipients only
  // (suppressed addresses were never sent, so they don't count as outreach).
  const [rows] = await db.query(
    `SELECT
        co.company_id                         AS company_id,
        co.company_name                       AS company_name,
        c.id                                  AS campaign_id,
        c.name                                AS campaign_name,
        c.created_at                          AS sent_at,
        COUNT(*)                              AS recipients,
        SUM(cr.opened_at  IS NOT NULL)        AS opened,
        SUM(cr.clicked_at IS NOT NULL)        AS clicked
       FROM campaign_recipients cr
       JOIN campaigns c   ON c.id = cr.campaign_id AND c.user_id = ?
       JOIN contacts  ct  ON ct.id = cr.contact_id
       JOIN companies co  ON co.company_id = ct.company_id
      WHERE cr.status <> 'suppressed'
      GROUP BY co.company_id, co.company_name, c.id, c.name, c.created_at
      ORDER BY co.company_name ASC, c.created_at DESC`,
    [session.id]
  );

  // Group the flat rows into companies, each with its list of campaigns.
  type Campaign = {
    campaign_id: string;
    campaign_name: string;
    sent_at: string | null;
    recipients: number;
    opened: number;
    clicked: number;
  };
  type Company = {
    company_id: string;
    company_name: string;
    campaigns_sent: number;
    recipients: number;
    opened: number;
    clicked: number;
    responded: number;
    last_sent: string | null;
    last_reply: string | null;
    campaigns: Campaign[];
  };

  const byCompany = new Map<string, Company>();
  for (const r of rows as any[]) {
    const id = r.company_id;
    let comp = byCompany.get(id);
    if (!comp) {
      comp = {
        company_id: id,
        company_name: r.company_name || id,
        campaigns_sent: 0,
        recipients: 0,
        opened: 0,
        clicked: 0,
        responded: 0,
        last_sent: null,
        last_reply: null,
        campaigns: [],
      };
      byCompany.set(id, comp);
    }
    const recipients = Number(r.recipients) || 0;
    const opened = Number(r.opened) || 0;
    const clicked = Number(r.clicked) || 0;
    const sentAt = r.sent_at ? new Date(r.sent_at).toISOString() : null;
    comp.campaigns.push({
      campaign_id: r.campaign_id,
      campaign_name: r.campaign_name || "(untitled)",
      sent_at: sentAt,
      recipients,
      opened,
      clicked,
    });
    comp.campaigns_sent += 1;
    comp.recipients += recipients;
    comp.opened += opened;
    comp.clicked += clicked;
    if (sentAt && (!comp.last_sent || sentAt > comp.last_sent)) comp.last_sent = sentAt;
  }

  // ---- reply detection ----------------------------------------------------
  // Build a map of every emailed address -> company, then scan the connected
  // mailbox for senders that match. A company "responded" if at least one
  // person we emailed there has sent us mail.
  let mailboxConnected = false;
  let repliesChecked = false;
  let repliesError: string | null = null;

  if (wantReplies) {
    const account = await getMailAccountRow(session.id);
    mailboxConnected = !!account;
    if (account) {
      const [mapRows] = await db.query(
        `SELECT DISTINCT LOWER(cr.email) AS email, co.company_id AS company_id
           FROM campaign_recipients cr
           JOIN campaigns c  ON c.id = cr.campaign_id AND c.user_id = ?
           JOIN contacts  ct ON ct.id = cr.contact_id
           JOIN companies co ON co.company_id = ct.company_id
          WHERE cr.status <> 'suppressed' AND cr.email IS NOT NULL`,
        [session.id]
      );
      const emailToCompany = new Map<string, string>();
      for (const r of mapRows as any[]) {
        if (r.email) emailToCompany.set(String(r.email), r.company_id);
      }

      try {
        // Scan recent inbox messages; match senders to emailed contacts.
        const messages = await listMessages(toImapConfig(account), { limit: 200 });
        const respondedEmails = new Map<string, Set<string>>(); // companyId -> emails
        for (const m of messages) {
          const sender = (m.fromAddress || "").trim().toLowerCase();
          if (!sender) continue;
          const companyId = emailToCompany.get(sender);
          if (!companyId) continue;
          const comp = byCompany.get(companyId);
          if (!comp) continue;
          if (!respondedEmails.has(companyId)) respondedEmails.set(companyId, new Set());
          respondedEmails.get(companyId)!.add(sender);
          if (m.date && (!comp.last_reply || m.date > comp.last_reply)) comp.last_reply = m.date;
        }
        respondedEmails.forEach((emails, companyId) => {
          const comp = byCompany.get(companyId);
          if (comp) comp.responded = emails.size;
        });
        repliesChecked = true;
      } catch (e: any) {
        repliesError = e?.message || "Could not scan mailbox for replies";
      }
    }
  }

  const companies = Array.from(byCompany.values()).sort((a, b) => {
    // Most recently contacted first.
    return (b.last_sent || "").localeCompare(a.last_sent || "");
  });

  const totals = {
    companies: companies.length,
    campaigns: new Set((rows as any[]).map((r) => r.campaign_id)).size,
    recipients: companies.reduce((s, c) => s + c.recipients, 0),
    responded: companies.filter((c) => c.responded > 0).length,
  };

  return NextResponse.json({
    companies,
    totals,
    mailboxConnected,
    repliesChecked,
    repliesError,
  });
}
