import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getUser();
  if (!session) return NextResponse.json({ sender: null });
  const [rows] = await db.execute(
    `SELECT id, email, status, verified_at, changes_used
       FROM email_identities
      WHERE user_id = ?
      ORDER BY updated_at DESC
      LIMIT 1`,
    [session.id]
  );
  const arr = rows as any[];
  return NextResponse.json({ sender: arr[0] ?? null });
}
