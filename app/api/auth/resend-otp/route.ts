import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { generateOtp, OTP_TTL_MIN } from "@/lib/otp";
import { sendVerificationOtpEmail, shouldExposeOtpInResponse } from "@/lib/email";
import { checkLoginRate, loginRateKey } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim() || "unknown";
  return req.headers.get("x-real-ip") || "unknown";
}

const GENERIC_MESSAGE = "If that email needs verification, a new code has been sent.";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
  }

  const rate = await checkLoginRate(loginRateKey(`otp-resend:${email}`, clientIp(req)));
  if (!rate.ok) {
    return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
  }

  // Need a pending row to refresh; otherwise the resend is a no-op.
  const [rows] = await db.execute(
    "SELECT email FROM pending_registrations WHERE email = ? LIMIT 1",
    [email]
  );
  if (!(rows as any[]).length) {
    return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
  }

  const code = generateOtp();
  const code_hash = await bcrypt.hash(code, 10);
  const expires = new Date(Date.now() + OTP_TTL_MIN * 60 * 1000);

  await db.execute(
    `UPDATE pending_registrations
        SET code_hash = ?, expires_at = ?, attempts = 0
      WHERE email = ?`,
    [code_hash, expires, email]
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
    console.error("[resend-otp] threw", e);
  }

  const response: any = { ok: true, message: GENERIC_MESSAGE };
  if (shouldExposeOtpInResponse()) {
    response.devCode = code;
    response.message =
      "Resend isn't configured — code shown below for development.";
    if (emailWarning) response.emailWarning = emailWarning;
  }

  return NextResponse.json(response);
}
