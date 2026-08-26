#!/usr/bin/env node
// Quick: list all users (id, email, role, email_verified).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import mysql from "mysql2/promise";

// Dev machines keep credentials in .env.local; the deployed server uses .env.
// Reading only one of them is how this ends up connecting as no user at all.
for (const envFile of [".env.local", ".env"]) {
  try {
    const text = readFileSync(resolve(process.cwd(), envFile), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
}

if (!process.env.MYSQL_USER) {
  console.error("No MYSQL_USER found. Run from the repo root, where .env.local or .env lives.");
  process.exit(1);
}

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
