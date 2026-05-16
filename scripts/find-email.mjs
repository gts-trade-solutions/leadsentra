#!/usr/bin/env node
// Find an email across users / contacts / suppressions / campaign_recipients.
// Usage: node scripts/find-email.mjs derinroxx@gmail.com

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

const email = (process.argv[2] || "").trim().toLowerCase();
if (!email) { console.error("Usage: node scripts/find-email.mjs <email>"); process.exit(1); }

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

for (const [label, sql] of [
  ["users",                "SELECT id, email, role FROM users WHERE LOWER(email) = ?"],
  ["contacts",             "SELECT id, contact_name, email FROM contacts WHERE LOWER(email) = ?"],
  ["suppressions",         "SELECT id, user_id, email, reason FROM suppressions WHERE LOWER(email) = ?"],
  ["campaign_recipients",  "SELECT id, campaign_id, email, status FROM campaign_recipients WHERE LOWER(email) = ?"],
  ["email_identities",     "SELECT id, user_id, email, status FROM email_identities WHERE LOWER(email) = ?"],
]) {
  try {
    const [rows] = await conn.execute(sql, [email]);
    console.log(`\n[${label}] ${rows.length} row(s)`);
    if (rows.length) console.table(rows);
  } catch (e) {
    console.log(`\n[${label}] error: ${e.message}`);
  }
}

await conn.end();
