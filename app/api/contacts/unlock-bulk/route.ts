import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.contact_ids) ? body.contact_ids : [];
  if (!ids.length) return NextResponse.json({ error: "Missing contact_ids" }, { status: 400 });

  try {
    const [result] = await db.query("CALL unlock_contacts_bulk(?, CAST(? AS JSON))", [
      session.id,
      JSON.stringify(ids),
    ]);
    const arr = Array.isArray(result) ? (result[0] as any[]) : [];
    const row = arr?.[0] ?? { unlocked: ids.length };
    return NextResponse.json(row);
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg.includes("insufficient_credits")) {
      return NextResponse.json({ status: "INSUFFICIENT_CREDITS", insufficient_credits: true }, { status: 402 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
