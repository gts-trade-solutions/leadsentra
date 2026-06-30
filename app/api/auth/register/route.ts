import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { validatePassword } from "@/lib/password";
import { signSession, setSessionCookie } from "@/lib/auth";
import { checkLoginRate, loginRateKey } from "@/lib/rateLimit";
import { requestMembership } from "@/lib/memberships";

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

/**
 * POST /api/auth/register
 *
 * Creates a user account directly, no email-OTP step. The previous flow
 * staged the signup in `pending_registrations`, emailed a 6-digit code,
 * and only promoted to `users` after /api/auth/verify-otp. That dance was
 * removed at user request — accounts are now usable immediately on submit.
 *
 * Trade-off accepted: we no longer prove the user owns the email at signup.
 * `email_verified` is set to 0 so we can require sender-identity verification
 * later through SES (separate flow, /api/email/start + /api/email/status).
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const full_name = body.full_name ? String(body.full_name).trim() : null;
  const joinCompanyId = body.company_id ? String(body.company_id).trim().slice(0, 36) : null;

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
  }

  const pwError = validatePassword(password);
  if (pwError) {
    return NextResponse.json({ error: pwError }, { status: 400 });
  }

  // Company to join is required at signup.
  if (!joinCompanyId) {
    return NextResponse.json({ error: "Please choose the company you want to join." }, { status: 400 });
  }
  const [companyRows] = await db.execute(
    "SELECT company_id FROM companies WHERE company_id = ? LIMIT 1",
    [joinCompanyId]
  );
  if (!(companyRows as any[]).length) {
    return NextResponse.json({ error: "That company was not found. Please pick one from the list." }, { status: 400 });
  }

  // Throttle so a script can't flood signups.
  const rate = await checkLoginRate(loginRateKey(`register:${email}`, clientIp(req)));
  if (!rate.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait and try again.", retryAfter: rate.retryAfter },
      { status: 429, headers: { "Retry-After": String(rate.retryAfter ?? 60) } }
    );
  }

  const [existing] = await db.execute(
    "SELECT id FROM users WHERE email = ? LIMIT 1",
    [email]
  );
  if ((existing as any[]).length) {
    return NextResponse.json(
      { error: "An account with that email already exists. Please sign in." },
      { status: 409 }
    );
  }

  const id = randomUUID();
  const password_hash = await bcrypt.hash(password, 10);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    await conn.execute(
      `INSERT INTO users (id, email, password_hash, full_name, role, email_verified)
       VALUES (?, ?, ?, ?, 'user', 0)`,
      [id, email, password_hash, full_name]
    );

    // Seed wallets so spend_credit() and the wallet UI work immediately.
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

    await conn.commit();
  } catch (e: any) {
    await conn.rollback();
    if (e?.code === "ER_DUP_ENTRY") {
      return NextResponse.json(
        { error: "An account with that email already exists. Please sign in." },
        { status: 409 }
      );
    }
    console.error("[register] account create failed", e);
    return NextResponse.json(
      { error: "Could not create account. Please try again." },
      { status: 500 }
    );
  } finally {
    conn.release();
  }

  // If the user picked a company to join at signup, raise a pending request
  // (admin approves later). Best-effort: never block account creation on it.
  let joinRequested = false;
  if (joinCompanyId) {
    try {
      const r = await requestMembership(id, joinCompanyId);
      joinRequested = "status" in r;
    } catch (e) {
      console.error("[register] join request failed", e);
    }
  }

  // Auto-sign-in — set the session cookie so the client lands on the portal
  // already authenticated.
  const sessionToken = signSession({ id, email, role: "user" });
  setSessionCookie(sessionToken);

  return NextResponse.json({
    ok: true,
    user: { id, email, full_name, role: "user" },
    joinRequested,
  });
}
