import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { isStaff } from "@/lib/admin";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const contact_id = body?.contact_id;
  if (!contact_id) return NextResponse.json({ error: "Missing contact_id" }, { status: 400 });

  // Staff bypass: admins/moderators unlock for free.  We can't use the
  // unlock_contact stored proc here because it always calls spend_credit;
  // instead we record the unlock rows directly.
  if (isStaff(session.role)) {
    await db.execute(
      "INSERT IGNORE INTO unlocked_contacts (user_id, contact_id) VALUES (?, ?)",
      [session.id, contact_id]
    );
    await db.execute(
      "INSERT IGNORE INTO contacts_unlocks (user_id, contact_id) VALUES (?, ?)",
      [session.id, contact_id]
    );
    return NextResponse.json({ ok: 1, status: "unlocked", staff_bypass: 1 });
  }

  try {
    // Calls the MySQL stored procedure unlock_contact(p_user_id, p_contact_id).
    // It internally calls spend_credit and signals 'insufficient_credits' on failure.
    const [result] = await db.query("CALL unlock_contact(?, ?)", [session.id, contact_id]);
    const arr = Array.isArray(result) ? (result[0] as any[]) : [];
    const row = arr?.[0] ?? null;
    return NextResponse.json(row ?? { ok: 1, status: "unlocked" });
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg.includes("insufficient_credits")) {
      return NextResponse.json({ status: "INSUFFICIENT_CREDITS" }, { status: 402 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
