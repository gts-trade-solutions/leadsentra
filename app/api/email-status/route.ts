import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { isStaff } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUS_VALUES = new Set([
  "queued", "sent", "delivered", "opened", "clicked",
  "bounced", "complained", "suppressed", "failed",
]);

/**
 * GET /api/email-status
 *
 * Query params:
 *   from       YYYY-MM-DD (inclusive, optional)
 *   to         YYYY-MM-DD (inclusive, optional)
 *   status     one of STATUS_VALUES, or 'all'
 *   q          search recipient email/name
 *   campaignId restrict to one campaign
 *   page       1-based
 *   limit      max 500 (default 100)
 */
export async function GET(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const from = (url.searchParams.get("from") || "").trim();
  const to = (url.searchParams.get("to") || "").trim();
  const status = (url.searchParams.get("status") || "all").toLowerCase();
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const campaignId = (url.searchParams.get("campaignId") || "").trim();
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const limit = Math.min(Math.max(1, Number(url.searchParams.get("limit") || 100)), 500);
  const offset = (page - 1) * limit;

  // Staff (admin/moderator) see every campaign in the system; regular users
  // only see their own.
  const staffBypass = isStaff(session.role);
  const where: string[] = [];
  const params: any[] = [];
  if (!staffBypass) {
    where.push("c.user_id = ?");
    params.push(session.id);
  }

  if (from) { where.push("cr.created_at >= ?"); params.push(`${from} 00:00:00`); }
  if (to)   { where.push("cr.created_at <= ?"); params.push(`${to} 23:59:59`); }
  if (campaignId) { where.push("cr.campaign_id = ?"); params.push(campaignId); }
  if (STATUS_VALUES.has(status)) { where.push("cr.status = ?"); params.push(status); }
  if (q) {
    where.push("(LOWER(cr.email) LIKE ? OR LOWER(co.contact_name) LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }
  // Guard against an empty WHERE (would produce invalid SQL: "WHERE ").
  // Happens for staff with no filters at all.
  const whereSql = where.length ? where.join(" AND ") : "1=1";

  // Paged rows
  const [rows] = await db.query(
    `SELECT
        cr.id, cr.campaign_id, cr.contact_id, cr.email, cr.status,
        cr.message_id, cr.created_at AS sent_at,
        cr.opened_at, cr.clicked_at, cr.last_event_at,
        cr.bounced_at, cr.complaint_at,
        cr.opens_count, cr.clicks_count,
        co.contact_name,
        c.name AS campaign_name
       FROM campaign_recipients cr
       JOIN campaigns c ON c.id = cr.campaign_id
       LEFT JOIN contacts co ON co.id = cr.contact_id
      WHERE ${whereSql}
      ORDER BY cr.created_at DESC, cr.id DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params
  );

  // Filtered total
  const [[totalRow]] = await db.query(
    `SELECT COUNT(*) AS total
       FROM campaign_recipients cr
       JOIN campaigns c ON c.id = cr.campaign_id
       LEFT JOIN contacts co ON co.id = cr.contact_id
      WHERE ${whereSql}`,
    params
  ) as any;
  const total = Number(totalRow?.total || 0);

  // Status counts (using the same filters EXCEPT the status filter itself,
  // so the chips can show counts for each option)
  const cWhere: string[] = [];
  const cParams: any[] = [];
  if (!staffBypass) {
    cWhere.push("c.user_id = ?");
    cParams.push(session.id);
  }
  if (from) { cWhere.push("cr.created_at >= ?"); cParams.push(`${from} 00:00:00`); }
  if (to)   { cWhere.push("cr.created_at <= ?"); cParams.push(`${to} 23:59:59`); }
  if (campaignId) { cWhere.push("cr.campaign_id = ?"); cParams.push(campaignId); }
  if (q) {
    cWhere.push("(LOWER(cr.email) LIKE ? OR LOWER(co.contact_name) LIKE ?)");
    cParams.push(`%${q}%`, `%${q}%`);
  }
  const [countRows] = await db.query(
    `SELECT cr.status, COUNT(*) AS n,
            SUM(CASE WHEN cr.opens_count > 0 THEN 1 ELSE 0 END) AS opened_unique,
            SUM(CASE WHEN cr.clicks_count > 0 THEN 1 ELSE 0 END) AS clicked_unique
       FROM campaign_recipients cr
       JOIN campaigns c ON c.id = cr.campaign_id
       LEFT JOIN contacts co ON co.id = cr.contact_id
      WHERE ${cWhere.length ? cWhere.join(" AND ") : "1=1"}
      GROUP BY cr.status`,
    cParams
  );

  const counts: Record<string, number> = {};
  let openedUnique = 0;
  let clickedUnique = 0;
  for (const r of countRows as any[]) {
    counts[r.status] = Number(r.n || 0);
    openedUnique += Number(r.opened_unique || 0);
    clickedUnique += Number(r.clicked_unique || 0);
  }

  const sent =
    (counts.sent || 0) +
    (counts.delivered || 0) +
    (counts.opened || 0) +
    (counts.clicked || 0) +
    (counts.bounced || 0) +
    (counts.complained || 0);
  const suppressed = counts.suppressed || 0;
  const queued = counts.queued || 0;
  const bounced = counts.bounced || 0;
  const complained = counts.complained || 0;

  return NextResponse.json({
    rows,
    page,
    limit,
    total,
    counts,
    summary: {
      sent,
      delivered: counts.delivered || 0,
      opened_unique: openedUnique,
      clicked_unique: clickedUnique,
      bounced,
      complained,
      suppressed,
      queued,
      open_rate: sent > 0 ? Math.round((openedUnique / sent) * 100) : 0,
      click_rate: sent > 0 ? Math.round((clickedUnique / sent) * 100) : 0,
      bounce_rate: sent > 0 ? Math.round(((bounced + complained) / sent) * 100) : 0,
    },
  });
}
