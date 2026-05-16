#!/usr/bin/env node
// One-shot helper: promote a user to admin (or moderator) by email.
// Usage:
//   node scripts/promote-admin.mjs you@example.com          -> role='admin'
//   node scripts/promote-admin.mjs you@example.com moderator -> role='moderator'
//
// Reads MYSQL_* from .env.local in the project root.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import mysql from "mysql2/promise";

function loadDotEnv(path) {
  try {
    const text = readFileSync(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!(m[1] in process.env)) process.env[m[1]] = v;
    }
  } catch {
    // ignore
  }
}

loadDotEnv(resolve(process.cwd(), ".env.local"));

const email = (process.argv[2] || "").trim().toLowerCase();
const role = (process.argv[3] || "admin").trim().toLowerCase();

if (!email) {
  console.error("Usage: node scripts/promote-admin.mjs <email> [admin|moderator|user]");
  process.exit(1);
}
if (!["admin", "moderator", "user"].includes(role)) {
  console.error(`Invalid role '${role}'. Must be admin, moderator, or user.`);
  process.exit(1);
}

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

try {
  const [rows] = await conn.execute(
    "SELECT id, email, role FROM users WHERE LOWER(email) = ? LIMIT 1",
    [email]
  );
  if (!rows.length) {
    console.error(`No user found with email '${email}'.`);
    process.exit(2);
  }
  const before = rows[0];
  if (before.role === role) {
    console.log(`${email} is already '${role}'. Nothing to do.`);
    process.exit(0);
  }
  // Staff accounts (admin/moderator) must be email-verified to log in.
  // Auto-verify when promoting so the account is usable.
  if (role === "admin" || role === "moderator") {
    await conn.execute(
      "UPDATE users SET role = ?, email_verified = 1 WHERE id = ?",
      [role, before.id]
    );
  } else {
    await conn.execute("UPDATE users SET role = ? WHERE id = ?", [role, before.id]);
  }
  console.log(`OK: ${email}  ${before.role} -> ${role}`);
  console.log("Sign out and sign back in so your JWT picks up the new role.");
} finally {
  await conn.end();
}
