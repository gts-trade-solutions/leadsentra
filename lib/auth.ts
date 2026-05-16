import { cookies } from "next/headers";
import jwt from "jsonwebtoken";
import { db } from "./db";

export const SESSION_COOKIE = "session";
const ONE_WEEK_SEC = 60 * 60 * 24 * 7;

function secret(): string {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("JWT_SECRET is not set");
  return s;
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, msg: string) {
    super(msg);
    this.status = status;
  }
}

export type SessionUser = {
  id: string;
  email: string;
  role: string;
};

export function signSession(user: SessionUser): string {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    secret(),
    { expiresIn: ONE_WEEK_SEC }
  );
}

export function verifySession(token: string): SessionUser | null {
  try {
    const p = jwt.verify(token, secret()) as any;
    if (!p?.sub || !p?.email) return null;
    return { id: String(p.sub), email: String(p.email), role: String(p.role || "user") };
  } catch {
    return null;
  }
}

/**
 * Returns the current user from the JWT cookie, or null.
 * Mirrors the previous Supabase `getUser()` semantics: lookup-only, no throw.
 */
export async function getUser(): Promise<SessionUser | null> {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySession(token);
}

/**
 * Throws HttpError(401) if no valid session.
 * Same call-shape as the old `requireUser()` so existing API routes don't change.
 */
export async function requireUser(): Promise<SessionUser> {
  const u = await getUser();
  if (!u) throw new HttpError(401, "Not signed in");
  return u;
}

/** Set/clear the session cookie helpers (for /api/auth/* route handlers). */
export function setSessionCookie(token: string) {
  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ONE_WEEK_SEC,
  });
}

export function clearSessionCookie() {
  cookies().set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

/** DB helpers for the auth routes. */
export async function findUserByEmail(email: string) {
  const [rows] = await db.execute(
    "SELECT id, email, password_hash, full_name, role, email_verified FROM users WHERE email = ? LIMIT 1",
    [email]
  );
  const arr = rows as any[];
  return arr[0] || null;
}

export async function findUserById(id: string) {
  const [rows] = await db.execute(
    "SELECT id, email, full_name, role, email_verified, created_at FROM users WHERE id = ? LIMIT 1",
    [id]
  );
  const arr = rows as any[];
  return arr[0] || null;
}
