import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getUser();
  if (!session) return NextResponse.json({ balance: 0, user: null });

  const [rows] = await db.execute(
    "SELECT balance FROM credits_wallets WHERE user_id = ? LIMIT 1",
    [session.id]
  );
  const arr = rows as any[];
  const balance = arr.length ? Number(arr[0].balance) : 0;
  return NextResponse.json({ balance });
}
