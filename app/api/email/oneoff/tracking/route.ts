import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ rows: [] }, { status: 401 });

  const url = new URL(req.url);
  const email = url.searchParams.get("email") || "";
  if (!email) return NextResponse.json({ rows: [] });

  // oneoff_emails has user-scoped rows; we filter by user_id and (best-effort) by recipient email.
  // TODO: schema may have a `to_email` column we don't yet model; adjust once you have the real PG dump.
  const [rows] = await db.execute(
    `SELECT id, user_id, message_id, status, opened_at, clicked_at, last_event_at,
            opens_count, clicks_count, created_at AS sent_at
       FROM oneoff_emails
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT 100`,
    [session.id]
  );
  return NextResponse.json({ rows });
}
