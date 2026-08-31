#!/usr/bin/env node
//
// Show what is on the suppression list, per user account.
//
// The Suppressions page in the portal only ever shows the rows belonging to
// the account you are signed in as. When an import writes to three different
// accounts, signing in as a fourth shows an empty list and it looks like
// nothing was written. This prints the whole picture from the server side.
//
// Read-only. Changes nothing.
//
// Usage:
//   node scripts/show-suppressions.mjs                    # counts for every user
//   node scripts/show-suppressions.mjs user@example.com   # that user, with rows
//   node scripts/show-suppressions.mjs user@example.com 50

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import mysql from "mysql2/promise";

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

const argEmail = (process.argv[2] || "").trim().toLowerCase();
const limit = Math.min(Math.max(Number(process.argv[3] || 25), 1), 500);

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

console.log(`\n${"=".repeat(78)}`);
console.log("Suppression list by account");
console.log(`${"=".repeat(78)}`);
console.log(
  "  These are what the portal's Suppressions page shows — but ONLY for the\n" +
  "  account you are signed in as. Sign in as one of the accounts below to see\n" +
  "  its rows.\n"
);

// `corrected` rows are still in the table but loadSuppressionSet ignores them,
// so an address can be listed and still mailable. Count them apart.
const [byUser] = await conn.query(
  `SELECT u.email AS user_email,
          COUNT(*)                                                   AS total,
          SUM(s.source = 'bounce')                                   AS bounces,
          SUM(s.source = 'complaint')                                AS complaints,
          SUM(s.source = 'unsubscribe')                              AS unsubscribes,
          SUM(s.source = 'manual')                                   AS manual,
          SUM(s.corrected = 1)                                       AS corrected,
          SUM(s.reason LIKE 'SES account suppression list%')          AS from_ses_import,
          SUM(s.reason LIKE '%has no MX or A record%')                AS from_dns_check,
          MAX(s.created_at)                                          AS newest
     FROM suppressions s
     JOIN users u ON u.id = s.user_id
    ${argEmail ? "WHERE LOWER(u.email) = ?" : ""}
    GROUP BY u.email
    ORDER BY total DESC`,
  argEmail ? [argEmail] : []
);

if (!byUser.length) {
  console.log(
    argEmail
      ? `  No suppression rows for '${argEmail}'.`
      : "  No suppression rows at all."
  );
} else {
  const w = Math.max(...byUser.map((r) => String(r.user_email).length), 20);
  console.log(
    `  ${"account".padEnd(w)}  ${"total".padStart(7)} ${"bounce".padStart(7)} ${"compl".padStart(6)} ` +
    `${"unsub".padStart(6)} ${"manual".padStart(7)} ${"corr'd".padStart(7)}   newest`
  );
  console.log(`  ${"-".repeat(w)}  ${"-".repeat(52)}`);
  for (const r of byUser) {
    console.log(
      `  ${String(r.user_email).padEnd(w)}  ${String(r.total).padStart(7)} ${String(r.bounces || 0).padStart(7)} ` +
      `${String(r.complaints || 0).padStart(6)} ${String(r.unsubscribes || 0).padStart(6)} ` +
      `${String(r.manual || 0).padStart(7)} ${String(r.corrected || 0).padStart(7)}   ` +
      `${r.newest ? new Date(r.newest).toISOString().slice(0, 16).replace("T", " ") : "-"}`
    );
  }
  console.log("\n  Where they came from:");
  for (const r of byUser) {
    const ses = Number(r.from_ses_import || 0);
    const dns = Number(r.from_dns_check || 0);
    const other = Number(r.total) - ses - dns;
    console.log(
      `  ${String(r.user_email).padEnd(Math.max(...byUser.map((x) => String(x.user_email).length), 20))}  ` +
      `SES import: ${ses}   pre-send DNS check: ${dns}   other: ${other}`
    );
  }
  if (byUser.some((r) => Number(r.corrected || 0) > 0)) {
    console.log(
      "\n  NOTE: 'corrected' rows are on the list but are IGNORED when sending —\n" +
      "  they appear under the Corrected tab, not Bounce, and are still mailable."
    );
  }
}

if (argEmail && byUser.length) {
  console.log(`\n${"=".repeat(78)}`);
  console.log(`Most recent ${limit} rows for ${argEmail}`);
  console.log(`${"=".repeat(78)}`);
  const [rows] = await conn.query(
    `SELECT s.value, s.source, s.corrected, s.created_at, LEFT(COALESCE(s.reason, ''), 60) AS reason
       FROM suppressions s
       JOIN users u ON u.id = s.user_id
      WHERE LOWER(u.email) = ?
      ORDER BY s.created_at DESC, s.id DESC
      LIMIT ${limit}`,
    [argEmail]
  );
  const w = Math.max(...rows.map((r) => String(r.value).length), 10);
  for (const r of rows) {
    console.log(
      `  ${String(r.value).padEnd(w)}  ${String(r.source).padEnd(11)}` +
      `${Number(r.corrected) ? "[corrected] " : ""}${r.reason}`
    );
  }
}

// A suppression row only helps if it is actually consulted. Show the addresses
// that bounced but are NOT blocked — the ones that will be mailed again.
console.log(`\n${"=".repeat(78)}`);
console.log("Bounced recipients that are NOT blocked");
console.log(`${"=".repeat(78)}`);
const [gaps] = await conn.query(
  `SELECT u.email AS user_email, COUNT(DISTINCT cr.email) AS n
     FROM campaign_recipients cr
     JOIN campaigns c ON c.id = cr.campaign_id
     JOIN users u ON u.id = c.user_id
     LEFT JOIN suppressions s
            ON s.user_id = c.user_id
           AND s.type = 'email'
           AND s.value = LOWER(cr.email)
           AND (s.corrected IS NULL OR s.corrected = 0)
    WHERE cr.status IN ('bounced', 'complained')
      AND s.id IS NULL
    ${argEmail ? "AND LOWER(u.email) = ?" : ""}
    GROUP BY u.email ORDER BY n DESC`,
  argEmail ? [argEmail] : []
);
if (!gaps.length) {
  console.log("  None — every bounced address is on its owner's suppression list.");
} else {
  console.log("  These bounced but will be mailed again by the next campaign:\n");
  for (const g of gaps) console.log(`  ${String(g.user_email).padEnd(40)} ${g.n}`);
  console.log("\n  Fix:  node scripts/import-ses-suppressions.mjs");
}

console.log("");
await conn.end();
