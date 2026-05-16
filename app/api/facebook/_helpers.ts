import crypto from "crypto";
import { db } from "@/lib/db";
import { requireUser, HttpError } from "@/lib/auth";

export const FB_VER = "v23.0";
const APP_SECRET = process.env.FACEBOOK_APP_SECRET || "";

export function appsecret_proof(t: string) {
  return crypto.createHmac("sha256", APP_SECRET).update(t).digest("hex");
}

/**
 * Resolves the current user + their stored Facebook access token from MySQL.
 * Throws 401 if they aren't signed in or haven't connected Facebook.
 */
export async function requireUserAndFbToken() {
  const user = await requireUser();
  const [rows] = await db.execute(
    `SELECT access_token, fb_user_id
       FROM social_accounts
      WHERE user_id = ? AND provider = 'facebook'
      LIMIT 1`,
    [user.id]
  );
  const row = (rows as any[])[0];
  if (!row?.access_token) {
    throw new HttpError(401, "Facebook not connected");
  }
  return {
    userId: user.id,
    accessToken: row.access_token as string,
    fbUserId: (row.fb_user_id ?? null) as string | null,
  };
}
