import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { signSession, setSessionCookie } from "@/lib/auth";
import { OTP_LENGTH, OTP_MAX_ATTEMPTS } from "@/lib/otp";
import { checkLoginRate, loginRateKey } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SIGNUP_BONUS_CREDITS = (() => {
  const n = Number(process.env.SIGNUP_BONUS_CREDITS);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 100;
})();

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim() || "unknown";
  return req.headers.get("x-real-ip") || "unknown";
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const code = String(body.code || "").trim();

  if (!email || !code) {
    return NextResponse.json({ error: "Email and code are required" }, { status: 400 });
  }
  if (!/^\d{6}$/.test(code) || code.length !== OTP_LENGTH) {
    return NextResponse.json({ error: "Code must be 6 digits" }, { status: 400 });
  }

  const rate = await checkLoginRate(loginRateKey(`otp-verify:${email}`, clientIp(req)));
  if (!rate.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait and try again.", retryAfter: rate.retryAfter },
      { status: 429, headers: { "Retry-After": String(rate.retryAfter ?? 60) } }
    );
  }

  // If an account already exists for this email, the user probably finished
  // signup in another tab.
  const [existingUser] = await db.execute(
    "SELECT id FROM users WHERE email = ? LIMIT 1",
    [email]
  );
  if ((existingUser as any[]).length) {
    return NextResponse.json(
      { error: "Account already verified. Please sign in." },
      { status: 409 }
    );
  }

  // Look up the staged registration.
  const [rows] = await db.execute(
    `SELECT email, password_hash, full_name, code_hash, expires_at, attempts
       FROM pending_registrations
      WHERE email = ?
      LIMIT 1`,
    [email]
  );
  const row = (rows as any[])[0];
  if (!row) {
    return NextResponse.json(
      { error: "No pending signup for this email. Please sign up again." },
      { status: 400 }
    );
  }

  if (new Date(row.expires_at).getTime() < Date.now()) {
    await db.execute("DELETE FROM pending_registrations WHERE email = ?", [email]);
    return NextResponse.json({ error: "Code expired. Please sign up again." }, { status: 400 });
  }

  if (Number(row.attempts) >= OTP_MAX_ATTEMPTS) {
    await db.execute("DELETE FROM pending_registrations WHERE email = ?", [email]);
    return NextResponse.json(
      { error: "Too many wrong attempts. Please sign up again." },
      { status: 400 }
    );
  }

  const match = await bcrypt.compare(code, row.code_hash);
  if (!match) {
    await db.execute(
      "UPDATE pending_registrations SET attempts = attempts + 1 WHERE email = ?",
      [email]
    );
    return NextResponse.json({ error: "Invalid code" }, { status: 400 });
  }

  // ✅ Verified.  Promote the pending row to a real user, transactionally.
  const id = randomUUID();

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    await conn.execute(
      `INSERT INTO users (id, email, password_hash, full_name, role, email_verified)
       VALUES (?, ?, ?, ?, 'user', 1)`,
      [id, row.email, row.password_hash, row.full_name]
    );

    await conn.execute(
      "INSERT IGNORE INTO credits_wallets (user_id, balance) VALUES (?, ?)",
      [id, SIGNUP_BONUS_CREDITS]
    );
    await conn.execute(
      "INSERT IGNORE INTO wallet (user_id, balance) VALUES (?, ?)",
      [id, SIGNUP_BONUS_CREDITS]
    );
    if (SIGNUP_BONUS_CREDITS > 0) {
      await conn.execute(
        `INSERT INTO credits_ledger (user_id, delta, kind, correlation_id, note)
         VALUES (?, ?, 'credit', ?, 'Signup bonus')`,
        [id, SIGNUP_BONUS_CREDITS, `signup:${id}`]
      );
    }

    await conn.execute("DELETE FROM pending_registrations WHERE email = ?", [email]);

    await conn.commit();
  } catch (e: any) {
    await conn.rollback();
    if (e?.code === "ER_DUP_ENTRY") {
      return NextResponse.json(
        { error: "Account already verified. Please sign in." },
        { status: 409 }
      );
    }
    console.error("[verify-otp] promote failed", e);
    return NextResponse.json(
      { error: "Could not finish signup. Please try again." },
      { status: 500 }
    );
  } finally {
    conn.release();
  }

  // Auto-sign-in
  const sessionToken = signSession({ id, email: row.email, role: "user" });
  setSessionCookie(sessionToken);

  return NextResponse.json({
    ok: true,
    user: {
      id,
      email: row.email,
      full_name: row.full_name,
      role: "user",
    },
  });
}
