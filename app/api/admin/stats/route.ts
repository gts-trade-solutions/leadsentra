import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const gate = await requireRole("staff");
  if ("response" in gate) return gate.response;

  const queries: Record<string, string> = {
    users:       "SELECT COUNT(*) AS n FROM users",
    admins:      "SELECT COUNT(*) AS n FROM users WHERE role = 'admin'",
    moderators:  "SELECT COUNT(*) AS n FROM users WHERE role = 'moderator'",
    companies:   "SELECT COUNT(*) AS n FROM companies",
    contacts:    "SELECT COUNT(*) AS n FROM contacts",
    contacts_with_email: "SELECT COUNT(*) AS n FROM contacts WHERE email IS NOT NULL AND email <> ''",
    suppressions:"SELECT COUNT(*) AS n FROM suppressions",
    campaigns:   "SELECT COUNT(*) AS n FROM campaigns",
    sent_30d:    "SELECT COUNT(*) AS n FROM campaign_recipients WHERE status = 'delivered' AND created_at >= (NOW() - INTERVAL 30 DAY)",
  };
  const stats: Record<string, number> = {};
  for (const [k, sql] of Object.entries(queries)) {
    const [rows] = await db.query(sql);
    stats[k] = Number((rows as any[])[0]?.n || 0);
  }

  // Top wallet balances (admins might want to see who has the most credits)
  const [topWallets] = await db.execute(
    `SELECT u.id, u.email, u.role, w.balance
       FROM credits_wallets w
       JOIN users u ON u.id = w.user_id
      ORDER BY w.balance DESC
      LIMIT 5`
  );

  return NextResponse.json({ stats, topWallets });
}
