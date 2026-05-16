import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { validatePassword } from "@/lib/password";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const token = String(body.token || "").trim();
  const password = String(body.password || "");

  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

  const pwError = validatePassword(password);
  if (pwError) return NextResponse.json({ error: pwError }, { status: 400 });

  const [rows] = await db.execute(
    `SELECT user_id, expires_at, used_at
       FROM password_reset_tokens
      WHERE token = ?
      LIMIT 1`,
    [token]
  );
  const row = (rows as any[])[0];
  if (!row) {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 400 });
  }
  if (row.used_at) {
    return NextResponse.json({ error: "This reset link has already been used" }, { status: 400 });
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    await db.execute("DELETE FROM password_reset_tokens WHERE token = ?", [token]);
    return NextResponse.json({ error: "Reset link has expired" }, { status: 400 });
  }

  const hash = await bcrypt.hash(password, 10);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      "UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?",
      [hash, row.user_id]
    );
    // Burn the token + any other outstanding tokens for this user
    await conn.execute(
      "DELETE FROM password_reset_tokens WHERE user_id = ?",
      [row.user_id]
    );
    await conn.commit();
  } catch (e: any) {
    await conn.rollback();
    return NextResponse.json({ error: e?.message || "Reset failed" }, { status: 500 });
  } finally {
    conn.release();
  }

  return NextResponse.json({ ok: true });
}
