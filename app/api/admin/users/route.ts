import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/admin";
import { validatePassword } from "@/lib/password";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const gate = await requireRole("staff");
  if ("response" in gate) return gate.response;

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const role = url.searchParams.get("role"); // 'user' | 'moderator' | 'admin' | 'all' | null
  const limit = Math.min(Number(url.searchParams.get("limit") || 100), 500);
  const offset = Math.max(Number(url.searchParams.get("offset") || 0), 0);

  const where: string[] = [];
  const params: any[] = [];
  if (q) {
    where.push("(LOWER(u.email) LIKE ? OR LOWER(u.full_name) LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }
  if (role && role !== "all") {
    where.push("u.role = ?");
    params.push(role);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const [rows] = await db.query(
    `SELECT u.id, u.email, u.full_name, u.role, u.email_verified, u.created_at,
            COALESCE(w.balance, 0) AS balance
       FROM users u
       LEFT JOIN credits_wallets w ON w.user_id = u.id
       ${whereSql}
       ORDER BY u.created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
    params
  );

  const [[totalRow]] = await db.query(
    `SELECT COUNT(*) AS total FROM users u ${whereSql}`,
    params
  ) as any;

  return NextResponse.json({ users: rows, total: Number(totalRow?.total || 0) });
}

/**
 * Create a moderator (or, if caller is admin, another admin).
 * Body: { email, password, full_name?, role? }
 *   - role defaults to 'moderator'
 *   - only admins may set role='admin'
 *   - account is created with email_verified=1 (skip OTP), no signup bonus
 */
export async function POST(req: Request) {
  const gate = await requireRole("admin");
  if ("response" in gate) return gate.response;
  const caller = gate.user;

  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const full_name = body.full_name ? String(body.full_name).trim() : null;
  const role = String(body.role || "moderator").toLowerCase();

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password required" }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }
  if (role !== "moderator" && role !== "admin" && role !== "user") {
    return NextResponse.json({ error: "Invalid role" }, { status: 400 });
  }
  // Only admins can mint admins (defense in depth — outer requireRole already
  // requires admin, but this stays correct if we ever loosen that).
  if (role === "admin" && caller.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const pwErr = validatePassword(password);
  if (pwErr) return NextResponse.json({ error: pwErr }, { status: 400 });

  const [exists] = await db.execute("SELECT id FROM users WHERE email = ? LIMIT 1", [email]);
  if ((exists as any[]).length) {
    return NextResponse.json({ error: "An account with that email already exists" }, { status: 409 });
  }

  const id = randomUUID();
  const password_hash = await bcrypt.hash(password, 10);

  await db.execute(
    `INSERT INTO users (id, email, password_hash, full_name, role, email_verified)
     VALUES (?, ?, ?, ?, ?, 1)`,
    [id, email, password_hash, full_name, role]
  );
  // Staff accounts still get a wallet row (balance 0) so spend_credit() works
  await db.execute(
    "INSERT IGNORE INTO credits_wallets (user_id, balance) VALUES (?, 0)",
    [id]
  );
  await db.execute(
    "INSERT IGNORE INTO wallet (user_id, balance) VALUES (?, 0)",
    [id]
  );

  return NextResponse.json(
    { id, email, full_name, role, email_verified: 1 },
    { status: 201 }
  );
}
