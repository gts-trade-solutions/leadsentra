import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { sendPasswordResetEmail } from "@/lib/email";
import { checkLoginRate, loginRateKey } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TOKEN_TTL_MIN = 60;

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim() || "unknown";
  return req.headers.get("x-real-ip") || "unknown";
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();

  // Rate-limit per email+IP — same store as login so an attacker can't farm
  // emails to enumerate accounts.
  const rate = await checkLoginRate(loginRateKey(`forgot:${email}`, clientIp(req)));
  if (!rate.ok) {
    return NextResponse.json(
      {
        ok: true,
        message: "If that email exists, we've sent a reset link.",
      },
      { status: 200 }
    );
  }

  // Always return the same response regardless of whether the email exists
  // (don't leak account existence).
  const generic = NextResponse.json({
    ok: true,
    message: "If that email exists, we've sent a reset link.",
  });

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return generic;
  }

  const [rows] = await db.execute(
    "SELECT id FROM users WHERE email = ? LIMIT 1",
    [email]
  );
  const user = (rows as any[])[0];
  if (!user) return generic;

  // Invalidate any previous unused tokens for this user
  await db.execute(
    "DELETE FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL",
    [user.id]
  );

  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + TOKEN_TTL_MIN * 60 * 1000);
  await db.execute(
    `INSERT INTO password_reset_tokens (token, user_id, expires_at)
     VALUES (?, ?, ?)`,
    [token, user.id, expires]
  );

  try {
    await sendPasswordResetEmail(email, token);
  } catch (e) {
    console.error("[forgot] sendPasswordResetEmail failed", e);
  }

  return generic;
}
