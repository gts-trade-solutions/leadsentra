import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Removes the stored Facebook connection (also takes Instagram offline). */
export async function POST() {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await db.execute(
    "DELETE FROM social_accounts WHERE user_id = ? AND provider = 'facebook'",
    [session.id]
  );
  return NextResponse.json({ ok: true });
}
