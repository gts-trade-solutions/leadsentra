import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/admin/credits/topup
 * Body: { user_id, amount, note? }
 *
 * Atomically credits the target user's wallet + writes a ledger entry.
 * Negative amounts are allowed (admin can claw back credits) but cannot
 * drive the balance below zero — that returns 400.
 */
export async function POST(req: Request) {
  const gate = await requireRole("admin");
  if ("response" in gate) return gate.response;
  const caller = gate.user;

  const body = await req.json().catch(() => ({}));
  const user_id = String(body.user_id || "");
  const amount = Math.floor(Number(body.amount));
  const note = body.note ? String(body.note).trim().slice(0, 255) : null;

  if (!user_id) {
    return NextResponse.json({ error: "user_id required" }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount === 0) {
    return NextResponse.json({ error: "amount must be a non-zero integer" }, { status: 400 });
  }

  const [userRows] = await db.execute("SELECT id FROM users WHERE id = ? LIMIT 1", [user_id]);
  if (!(userRows as any[]).length) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Ensure wallet rows exist
    await conn.execute(
      "INSERT IGNORE INTO credits_wallets (user_id, balance) VALUES (?, 0)",
      [user_id]
    );
    await conn.execute(
      "INSERT IGNORE INTO wallet (user_id, balance) VALUES (?, 0)",
      [user_id]
    );

    const [walletRows] = await conn.execute(
      "SELECT balance FROM credits_wallets WHERE user_id = ? FOR UPDATE",
      [user_id]
    );
    const current = Number((walletRows as any[])[0]?.balance ?? 0);
    const next = current + amount;
    if (next < 0) {
      await conn.rollback();
      return NextResponse.json(
        { error: "Insufficient balance for clawback", balance: current, requested: amount },
        { status: 400 }
      );
    }

    await conn.execute(
      "UPDATE credits_wallets SET balance = balance + ?, updated_at = NOW() WHERE user_id = ?",
      [amount, user_id]
    );
    await conn.execute(
      "UPDATE wallet SET balance = balance + ? WHERE user_id = ?",
      [amount, user_id]
    );

    const kind = amount > 0 ? "credit" : "debit";
    const defaultNote = amount > 0 ? "Admin top-up" : "Admin clawback";
    await conn.execute(
      `INSERT INTO credits_ledger (user_id, delta, kind, correlation_id, note)
       VALUES (?, ?, ?, ?, ?)`,
      [user_id, amount, kind, `admin:${caller.id}:${Date.now()}`, note || defaultNote]
    );

    await conn.commit();
    return NextResponse.json({ ok: true, balance: next, applied: amount });
  } catch (e: any) {
    await conn.rollback();
    return NextResponse.json({ error: e?.message || "Top-up failed" }, { status: 500 });
  } finally {
    conn.release();
  }
}
