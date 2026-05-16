#!/usr/bin/env node
// Quick: list all users (id, email, role, email_verified).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import mysql from "mysql2/promise";

try {
  const text = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch {}

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

const [rows] = await conn.execute(
  "SELECT email, role, email_verified, created_at FROM users ORDER BY created_at DESC LIMIT 50"
);
console.log(`Found ${rows.length} user(s):`);
console.table(rows.map((r) => ({
  email: r.email,
  role: r.role,
  verified: r.email_verified ? "yes" : "no",
  created: r.created_at,
})));
await conn.end();
