import { randomInt } from "crypto";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";

export const OTP_LENGTH = 6;
export const OTP_TTL_MIN = 10;
export const OTP_MAX_ATTEMPTS = 5;

/** Generates a numeric OTP of OTP_LENGTH digits (zero-padded). */
export function generateOtp(): string {
  const max = 10 ** OTP_LENGTH;
  const n = randomInt(0, max);
  return String(n).padStart(OTP_LENGTH, "0");
}

/**
 * Persist a new OTP for the user, replacing any existing one.
 * Returns the cleartext OTP so the caller can email it.
 */
export async function issueOtp(userId: string): Promise<{ code: string; ttlMinutes: number }> {
  const code = generateOtp();
  const code_hash = await bcrypt.hash(code, 10);
  const expires = new Date(Date.now() + OTP_TTL_MIN * 60 * 1000);
  await db.query(
    `REPLACE INTO email_otp_codes (user_id, code_hash, expires_at, attempts)
     VALUES (?, ?, ?, 0)`,
    [userId, code_hash, expires]
  );
  return { code, ttlMinutes: OTP_TTL_MIN };
}

export type OtpVerifyResult =
  | { ok: true }
  | { ok: false; reason: "expired" | "no_code" | "too_many_attempts" | "invalid" };

/**
 * Constant-ish verify: looks up the row, checks expiry / attempts, bcrypt-compares.
 * On success the row is deleted; on failure attempts is incremented.
 */
export async function verifyOtp(userId: string, code: string): Promise<OtpVerifyResult> {
  const [rows] = await db.execute(
    "SELECT code_hash, expires_at, attempts FROM email_otp_codes WHERE user_id = ? LIMIT 1",
    [userId]
  );
  const row = (rows as any[])[0];
  if (!row) return { ok: false, reason: "no_code" };

  if (new Date(row.expires_at).getTime() < Date.now()) {
    await db.execute("DELETE FROM email_otp_codes WHERE user_id = ?", [userId]);
    return { ok: false, reason: "expired" };
  }
  if (Number(row.attempts) >= OTP_MAX_ATTEMPTS) {
    // Burn the code; force a resend
    await db.execute("DELETE FROM email_otp_codes WHERE user_id = ?", [userId]);
    return { ok: false, reason: "too_many_attempts" };
  }

  const match = await bcrypt.compare(code, row.code_hash);
  if (!match) {
    await db.execute(
      "UPDATE email_otp_codes SET attempts = attempts + 1 WHERE user_id = ?",
      [userId]
    );
    return { ok: false, reason: "invalid" };
  }

  await db.execute("DELETE FROM email_otp_codes WHERE user_id = ?", [userId]);
  return { ok: true };
}
