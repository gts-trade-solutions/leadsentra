import { NextResponse } from "next/server";
import { createHmac } from "crypto";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function balanceFromLedger(userId: string): Promise<number> {
  const [rows] = await db.execute(
    "SELECT COALESCE(SUM(delta), 0) AS bal FROM credits_ledger WHERE user_id = ?",
    [userId]
  );
  return Number((rows as any[])[0]?.bal || 0);
}

export async function POST(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const RZP_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
  if (!RZP_KEY_SECRET) {
    return NextResponse.json({ error: "Razorpay is not configured." }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const razorpay_payment_id = String(body.razorpay_payment_id || "");
  const razorpay_order_id = String(body.razorpay_order_id || "");
  const razorpay_signature = String(body.razorpay_signature || "");

  if (!razorpay_payment_id || !razorpay_order_id || !razorpay_signature) {
    return NextResponse.json(
      { verified: false, error: "Missing payment details" },
      { status: 400 }
    );
  }

  // Look up the payment row (must belong to this user)
  const [rows] = await db.execute(
    `SELECT id, user_id, status, credits, razorpay_payment_id
       FROM payments
      WHERE razorpay_order_id = ? AND user_id = ?
      LIMIT 1`,
    [razorpay_order_id, session.id]
  );
  const payRow = (rows as any[])[0];
  if (!payRow) {
    return NextResponse.json({ verified: false, error: "Payment not found" }, { status: 404 });
  }

  // Verify signature
  const expected = createHmac("sha256", RZP_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");
  const ok = expected === razorpay_signature.toLowerCase();

  if (!ok) {
    await db.execute(
      `UPDATE payments
          SET status = 'failed', razorpay_payment_id = ?, updated_at = NOW()
        WHERE razorpay_order_id = ?`,
      [razorpay_payment_id, razorpay_order_id]
    );
    return NextResponse.json(
      { verified: false, error: "Signature verification failed" },
      { status: 400 }
    );
  }

  // Idempotent: already paid?
  if (payRow.status === "paid") {
    const balance = await balanceFromLedger(session.id);
    return NextResponse.json({ verified: true, credited: 0, balance });
  }

  const credits = Number(payRow.credits || 0);
  const correlation_id = `rzp_${razorpay_payment_id}`;

  // Mark paid + credit (transactional)
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    await conn.execute(
      `UPDATE payments
          SET status = 'paid', razorpay_payment_id = ?, updated_at = NOW()
        WHERE razorpay_order_id = ?`,
      [razorpay_payment_id, razorpay_order_id]
    );

    // Idempotency on the ledger via correlation_id (no unique constraint on this
    // column in the inferred schema; we guard with a SELECT-then-INSERT inside
    // the transaction to avoid double-crediting on retry).
    const [existing] = await conn.execute(
      "SELECT id FROM credits_ledger WHERE correlation_id = ? LIMIT 1",
      [correlation_id]
    );
    let credited = 0;
    if (!(existing as any[]).length) {
      await conn.execute(
        `INSERT INTO credits_ledger (user_id, delta, kind, correlation_id, note)
         VALUES (?, ?, 'purchase', ?, 'Razorpay purchase')`,
        [session.id, credits, correlation_id]
      );
      credited = credits;

      // Reflect into wallets so spend_credit() / fn_available_credits() see it
      await conn.execute(
        `INSERT INTO credits_wallets (user_id, balance) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE balance = balance + VALUES(balance)`,
        [session.id, credits]
      );
      await conn.execute(
        `INSERT INTO wallet (user_id, balance) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE balance = balance + VALUES(balance)`,
        [session.id, credits]
      );
    }

    await conn.commit();

    const balance = await balanceFromLedger(session.id);
    return NextResponse.json({ verified: true, credited, balance });
  } catch (e: any) {
    await conn.rollback();
    return NextResponse.json(
      { verified: true, credited: 0, warning: "Ledger update failed: " + (e?.message || String(e)) }
    );
  } finally {
    conn.release();
  }
}
