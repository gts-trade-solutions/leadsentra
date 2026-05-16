import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter((x: any) => typeof x === "string" && x) : [];
  if (!ids.length) return NextResponse.json({ error: "Missing ids" }, { status: 400 });
  if (ids.length > 5000) return NextResponse.json({ error: "Too many ids (max 5000)" }, { status: 400 });

  const placeholders = ids.map(() => "?").join(",");
  const isAdmin = session.role === "admin";

  // Filter to rows the user is allowed to delete
  const [rows] = await db.query(
    isAdmin
      ? `SELECT id FROM contacts WHERE id IN (${placeholders})`
      : `SELECT id FROM contacts WHERE id IN (${placeholders}) AND (user_id = ? OR user_id IS NULL)`,
    isAdmin ? ids : [...ids, session.id]
  );
  const allowed = (rows as any[]).map((r) => r.id);
  if (!allowed.length) return NextResponse.json({ deleted: 0 });

  const ph = allowed.map(() => "?").join(",");
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(`DELETE FROM unlocked_contacts WHERE contact_id IN (${ph})`, allowed);
    await conn.query(`DELETE FROM contacts_unlocks WHERE contact_id IN (${ph})`, allowed);
    await conn.query(`DELETE FROM contacts WHERE id IN (${ph})`, allowed);
    await conn.commit();
  } catch (e: any) {
    await conn.rollback();
    return NextResponse.json({ error: e?.message || "Delete failed" }, { status: 500 });
  } finally {
    conn.release();
  }

  return NextResponse.json({ deleted: allowed.length, skipped: ids.length - allowed.length });
}
