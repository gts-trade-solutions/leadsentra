import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function appBase(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    "http://localhost:3000"
  );
}

function redirectTo(path: string) {
  return NextResponse.redirect(`${appBase()}${path}`);
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = (url.searchParams.get("token") || "").trim();
  if (!token) {
    return redirectTo("/auth/signin?verifyError=missing_token");
  }

  // Look up token + check expiry in one round-trip
  const [rows] = await db.execute(
    `SELECT user_id, expires_at
       FROM email_verification_tokens
      WHERE token = ?
      LIMIT 1`,
    [token]
  );
  const row = (rows as any[])[0];
  if (!row) {
    return redirectTo("/auth/signin?verifyError=invalid_token");
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    // Burn the expired token so it can't be reused
    await db.execute("DELETE FROM email_verification_tokens WHERE token = ?", [token]);
    return redirectTo("/auth/signin?verifyError=expired");
  }

  // Mark user verified + consume the token (and any siblings the user has)
  await db.execute(
    "UPDATE users SET email_verified = 1, updated_at = NOW() WHERE id = ?",
    [row.user_id]
  );
  await db.execute(
    "DELETE FROM email_verification_tokens WHERE user_id = ?",
    [row.user_id]
  );

  return redirectTo("/auth/signin?verified=1");
}
