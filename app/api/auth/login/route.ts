import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { findUserByEmail, signSession, setSessionCookie } from "@/lib/auth";
import { checkLoginRate, loginRateKey, recordSuccessfulLogin } from "@/lib/rateLimit";

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

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  }

  // ----- Rate limit BEFORE any expensive work (bcrypt / DB) -----
  const ip = clientIp(req);
  const rateKey = loginRateKey(email, ip);
  const rate = await checkLoginRate(rateKey);
  if (!rate.ok) {
    return NextResponse.json(
      {
        error: "Too many login attempts. Please wait and try again.",
        retryAfter: rate.retryAfter,
      },
      {
        status: 429,
        headers: { "Retry-After": String(rate.retryAfter ?? 60) },
      }
    );
  }

  const user = await findUserByEmail(email);
  if (!user) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }

  // Email verification gate (only after a successful password check, so we
  // don't reveal whether an email exists by varying the response).
  if (!user.email_verified) {
    return NextResponse.json(
      {
        error: "Please verify your email before signing in.",
        code: "email_not_verified",
      },
      { status: 403 }
    );
  }

  const token = signSession({ id: user.id, email: user.email, role: user.role });
  setSessionCookie(token);
  recordSuccessfulLogin(rateKey);

  return NextResponse.json({
    user: { id: user.id, email: user.email, full_name: user.full_name, role: user.role },
  });
}
