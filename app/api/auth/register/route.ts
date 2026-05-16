import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { validatePassword } from "@/lib/password";
import { sendVerificationOtpEmail, shouldExposeOtpInResponse } from "@/lib/email";
import { generateOtp, OTP_TTL_MIN } from "@/lib/otp";
import { checkLoginRate, loginRateKey } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim() || "unknown";
  return req.headers.get("x-real-ip") || "unknown";
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const full_name = body.full_name ? String(body.full_name).trim() : null;

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

  // Throttle so a script can't flood pending_registrations with junk.
  const rate = await checkLoginRate(loginRateKey(`register:${email}`, clientIp(req)));
  if (!rate.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait and try again.", retryAfter: rate.retryAfter },
      { status: 429, headers: { "Retry-After": String(rate.retryAfter ?? 60) } }
    );
  }

  // Refuse if an account with this email is already verified.
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

  // Stage the registration.  REPLACE so retrying signup with the same email
  // (different password / new OTP) supersedes the previous attempt.
  const password_hash = await bcrypt.hash(password, 10);
  const code = generateOtp();
  const code_hash = await bcrypt.hash(code, 10);
  const expires = new Date(Date.now() + OTP_TTL_MIN * 60 * 1000);

  await db.query(
    `REPLACE INTO pending_registrations
       (email, password_hash, full_name, code_hash, expires_at, attempts)
     VALUES (?, ?, ?, ?, ?, 0)`,
    [email, password_hash, full_name, code_hash, expires]
  );

  let emailWarning: string | null = null;
  try {
    const r = await sendVerificationOtpEmail(email, code, OTP_TTL_MIN);
    if (!r.ok) {
      emailWarning =
        r.reason === "not_configured"
          ? "RESEND_API_KEY is not set — email was not sent."
          : `Email send failed: ${r.error}`;
    }
  } catch (e: any) {
    emailWarning = e?.message || "Email send threw";
    console.error("[register] sendVerificationOtpEmail threw", e);
  }

  const body_response: any = {
    ok: true,
    email,
    message:
      "We emailed a 6-digit code. Enter it on the next screen to finish creating your account.",
  };

  // Dev-only: include the code in the response so the dev flow isn't blocked
  // when Resend isn't configured.  Never happens in production.
  if (shouldExposeOtpInResponse()) {
    body_response.devCode = code;
    body_response.message =
      "Resend isn't configured. We've shown your code below so you can continue testing.";
  }
  // Surface email-send errors as a warning so the UI can show "we couldn't send".
  if (emailWarning && shouldExposeOtpInResponse()) {
    body_response.emailWarning = emailWarning;
  }

  return NextResponse.json(body_response);
}
