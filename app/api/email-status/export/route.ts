import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { isStaff } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUS_VALUES = new Set([
  "queued", "sent", "delivered", "opened", "clicked",
  "bounced", "complained", "suppressed", "failed",
]);

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(req: Request) {
  const session = await getUser();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const from = (url.searchParams.get("from") || "").trim();
  const to = (url.searchParams.get("to") || "").trim();
  const status = (url.searchParams.get("status") || "all").toLowerCase();
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const campaignId = (url.searchParams.get("campaignId") || "").trim();

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

  const [rows] = await db.query(
    `SELECT
        c.name AS campaign_name,
        cr.email,
        co.contact_name,
        cr.status,
        cr.opens_count,
        cr.clicks_count,
        cr.opened_at,
        cr.clicked_at,
        cr.bounced_at,
        cr.complaint_at,
        cr.last_event_at,
        cr.created_at AS sent_at,
        cr.message_id
       FROM campaign_recipients cr
       JOIN campaigns c ON c.id = cr.campaign_id
       LEFT JOIN contacts co ON co.id = cr.contact_id
      WHERE ${where.length ? where.join(" AND ") : "1=1"}
      ORDER BY cr.created_at DESC, cr.id DESC
      LIMIT 100000`,
    params
  );

  const header = [
    "campaign_name", "email", "contact_name", "status",
    "opens_count", "clicks_count", "opened_at", "clicked_at",
    "bounced_at", "complaint_at", "last_event_at", "sent_at", "message_id",
  ];
  const lines = [header.join(",")];
  for (const r of rows as any[]) {
    lines.push(header.map((h) => csvEscape((r as any)[h])).join(","));
  }
  const body = lines.join("\n");
  const ts = new Date().toISOString().slice(0, 10);

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="email-tracking-${ts}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
