import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CHANGE_LIMIT_DEFAULT = 2;

export async function GET() {
  const session = await getUser();
  if (!session) return NextResponse.json({ connected: false }, { status: 401 });

  const [accRows] = await db.execute(
    `SELECT id, member_urn, expires_at
       FROM social_accounts
      WHERE user_id = ? AND provider = 'linkedin'
      LIMIT 1`,
    [session.id]
  );
  const acc = (accRows as any[])[0] || null;

  const [usageRows] = await db.execute(
    `SELECT changes_used
       FROM social_connection_usage
      WHERE user_id = ? AND provider = 'linkedin'
      LIMIT 1`,
    [session.id]
  );
  const used = Number((usageRows as any[])[0]?.changes_used ?? 0);
  const changesLeft = Math.max(0, CHANGE_LIMIT_DEFAULT - used);

  return NextResponse.json({
    connected: !!acc,
    member_urn: acc?.member_urn ?? null,
    expires_at: acc?.expires_at ?? null,
    changes_limit: CHANGE_LIMIT_DEFAULT,
    changes_used: used,
    changes_left: changesLeft,
  });
}
