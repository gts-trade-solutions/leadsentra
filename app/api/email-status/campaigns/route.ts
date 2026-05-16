import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { isStaff } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Returns the user's campaigns that have at least one recipient row in the
 * requested date range, with per-campaign event counts.  Used to populate the
 * "Filter by campaign" dropdown on the tracking page.
 */
export async function GET(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ campaigns: [] }, { status: 401 });

  const url = new URL(req.url);
  const from = (url.searchParams.get("from") || "").trim();
  const to = (url.searchParams.get("to") || "").trim();

  // Staff see every campaign in the system; regular users only see their own.
  const staffBypass = isStaff(session.role);
  const where: string[] = [];
  const params: any[] = [];
  if (!staffBypass) {
    where.push("c.user_id = ?");
    params.push(session.id);
  }
  if (from) { where.push("cr.created_at >= ?"); params.push(`${from} 00:00:00`); }
  if (to)   { where.push("cr.created_at <= ?"); params.push(`${to} 23:59:59`); }
  const whereSql = where.length ? where.join(" AND ") : "1=1";

  const [rows] = await db.query(
    `SELECT c.id, c.name, c.status, COUNT(cr.id) AS event_count
       FROM campaigns c
       LEFT JOIN campaign_recipients cr ON cr.campaign_id = c.id
      WHERE ${whereSql}
      GROUP BY c.id, c.name, c.status
      HAVING event_count > 0
      ORDER BY MAX(cr.created_at) DESC, c.created_at DESC
      LIMIT 200`,
    params
  );

  return NextResponse.json({ campaigns: rows });
}
