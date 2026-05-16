#!/usr/bin/env node
// Seeds the suppressions table with a realistic mix of bounce / complaint /
// unsubscribe / manual rows for every user, so the Suppressions page has
// data to look at out of the box.
//
// Usage: node scripts/seed-suppressions.mjs [email-of-target-user]
//        (omit the email arg to seed for ALL users)
//
// Safe to re-run: uses INSERT IGNORE on the (user_id, type, value) unique key,
// so duplicates are silently skipped.

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

const argEmail = (process.argv[2] || "").trim().toLowerCase();

const SAMPLES = [
  // BOUNCES — permanent (mailbox doesn't exist)
  { type: "email", value: "noexist.user@gmail.com",           source: "bounce",      reason: "SES bounce: Permanent — Mailbox does not exist" },
  { type: "email", value: "old.account@yahoo.com",            source: "bounce",      reason: "SES bounce: Permanent — Recipient rejected" },
  { type: "email", value: "deactivated@outlook.com",          source: "bounce",      reason: "SES bounce: Permanent — Account deactivated" },
  { type: "email", value: "typo.amail@gmial.com",             source: "bounce",      reason: "SES bounce: Permanent — Domain typo (no MX)" },
  { type: "email", value: "wrongname@hotmail.com",            source: "bounce",      reason: "SES bounce: Permanent — No such user" },
  { type: "email", value: "former.employee@oldcompany.com",   source: "bounce",      reason: "SES bounce: Permanent — Mailbox full" },
  { type: "email", value: "test@nonexistent.example",         source: "bounce",      reason: "SES bounce: Permanent — Domain not found" },
  { type: "email", value: "junk@unreachable.dev",             source: "bounce",      reason: "SES bounce: Permanent — DNS lookup failed" },
  // COMPLAINTS — recipients hit "Mark as spam"
  { type: "email", value: "annoyed.user@gmail.com",           source: "complaint",   reason: "SES complaint — recipient marked as spam" },
  { type: "email", value: "spam.report@yahoo.com",            source: "complaint",   reason: "SES complaint — recipient marked as spam" },
  { type: "email", value: "no.thanks@outlook.com",            source: "complaint",   reason: "SES complaint — recipient marked as spam" },
  // UNSUBSCRIBES — clicked the unsubscribe link
  { type: "email", value: "former.subscriber@gmail.com",      source: "unsubscribe", reason: "User clicked unsubscribe link" },
  { type: "email", value: "left.list@outlook.com",            source: "unsubscribe", reason: "User clicked unsubscribe link" },
  // MANUAL — admin added directly
  { type: "email", value: "competitor@rival.com",             source: "manual",      reason: "Do not contact — competitor" },
  { type: "email", value: "boss@personalonly.com",            source: "manual",      reason: "VIP — do not include in marketing" },
  // DOMAIN-LEVEL — entire domain blocked
  { type: "domain", value: "spamtraps.net",                   source: "manual",      reason: "Known spam-trap domain" },
  { type: "domain", value: "throwaway-mail.example",          source: "manual",      reason: "Disposable email provider" },
];

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

const [userRows] = argEmail
  ? await conn.execute("SELECT id, email FROM users WHERE LOWER(email) = ? LIMIT 1", [argEmail])
  : await conn.execute("SELECT id, email FROM users");

if (!userRows.length) {
  console.error(`No user${argEmail ? ` matching '${argEmail}'` : "s"} found.`);
  process.exit(2);
}

let totalAdded = 0;
for (const u of userRows) {
  const values = [];
  const placeholders = [];
  for (const s of SAMPLES) {
    placeholders.push("(?, ?, ?, ?, ?)");
    values.push(u.id, s.type, s.value, s.reason, s.source);
  }
  const [res] = await conn.query(
    `INSERT IGNORE INTO suppressions (user_id, type, value, reason, source)
     VALUES ${placeholders.join(",")}`,
    values
  );
  const added = res.affectedRows || 0;
  totalAdded += added;
  console.log(`${u.email.padEnd(40)}  +${added} new (${SAMPLES.length - added} already there)`);
}

console.log(`\nTotal new rows: ${totalAdded}`);
await conn.end();
