import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { isStaff } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_STATUSES = new Set(["bounced", "complained", "failed"]);

/**
 * POST /api/campaigns/mark-inactive
 *
 * Bulk-suppresses recipients that already failed (bounce / complaint / hard fail).
 * Used by the Tracking page "Suppress all bounced" action so admins can drain
 * a dirty list into the suppression table with one click.
 *
 * Body shape (either form):
 *   { status: "bounced" | "complained" | "failed",
 *     from?: "YYYY-MM-DD", to?: "YYYY-MM-DD",
 *     campaign_id?: string }
 *
 *   { emails: string[] }    // explicit list (max 10k)
 *
 * Returns: { suppressed, alreadySuppressed, scanned }
 */
export async function POST(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));

  // Resolve target emails — either explicit array or DB query by status.
  let emails: string[] = [];
  if (Array.isArray(body?.emails) && body.emails.length) {
    emails = body.emails
      .map((e: any) => String(e || "").trim().toLowerCase())
      .filter((e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
      .slice(0, 10000);
  } else {
    const status = String(body?.status || "").toLowerCase();
    if (!ALLOWED_STATUSES.has(status)) {
      return NextResponse.json(
        { error: "status must be 'bounced', 'complained' or 'failed' (or pass emails[])" },
        { status: 400 }
      );
    }

    // Staff see global; regular users only see their own campaigns.
    const staffBypass = isStaff(session.role);
    const where: string[] = ["cr.status = ?"];
    const params: any[] = [status];
    if (!staffBypass) { where.push("c.user_id = ?"); params.push(session.id); }
    if (body.from) { where.push("cr.created_at >= ?"); params.push(`${body.from} 00:00:00`); }
    if (body.to)   { where.push("cr.created_at <= ?"); params.push(`${body.to} 23:59:59`); }
    if (body.campaign_id) { where.push("cr.campaign_id = ?"); params.push(String(body.campaign_id)); }

    const [rows] = await db.query(
      `SELECT DISTINCT cr.email, c.user_id
         FROM campaign_recipients cr
         JOIN campaigns c ON c.id = cr.campaign_id
        WHERE ${where.join(" AND ")}
        LIMIT 10000`,
      params
    );
    const groups: Record<string, string[]> = {};
    for (const r of rows as any[]) {
      const userId = r.user_id as string;
      const e = String(r.email || "").toLowerCase();
      if (!e) continue;
      (groups[userId] ||= []).push(e);
    }

    let suppressed = 0;
    let scanned = 0;
    const suppressionReason = status === "complained" ? "complaint" : status === "bounced" ? "bounce" : "manual";
    for (const [userId, list] of Object.entries(groups)) {
      scanned += list.length;
      if (!list.length) continue;
      const values: any[] = [];
      const placeholders: string[] = [];
      for (const e of list) {
        placeholders.push("(?, 'email', ?, ?, ?)");
        values.push(userId, e, `Bulk mark-inactive: ${status}`, suppressionReason);
      }
      const [res] = await db.query(
        `INSERT IGNORE INTO suppressions (user_id, type, value, reason, source)
         VALUES ${placeholders.join(",")}`,
        values
      );
      suppressed += (res as any)?.affectedRows ?? 0;
    }
    return NextResponse.json({
      suppressed,
      alreadySuppressed: scanned - suppressed,
      scanned,
    });
  }

  // Explicit emails branch: scoped to the caller's user_id.
  if (!emails.length) {
    return NextResponse.json({ suppressed: 0, alreadySuppressed: 0, scanned: 0 });
  }
  const values: any[] = [];
  const placeholders: string[] = [];
  for (const e of emails) {
    placeholders.push("(?, 'email', ?, 'Bulk add from tracking', 'manual')");
    values.push(session.id, e);
  }
  const [res] = await db.query(
    `INSERT IGNORE INTO suppressions (user_id, type, value, reason, source)
     VALUES ${placeholders.join(",")}`,
    values
  );
  const suppressed = (res as any)?.affectedRows ?? 0;
  return NextResponse.json({
    suppressed,
    alreadySuppressed: emails.length - suppressed,
    scanned: emails.length,
  });
}
