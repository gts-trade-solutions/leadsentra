#!/usr/bin/env node
//
// Import the AWS SES account-level suppression list into the app's per-user
// `suppressions` table, so addresses SES already refuses to deliver to stop
// being mailed.
//
// WHY YOU NEED THIS
//
// SES suppresses an address itself after a permanent bounce or a complaint.
// The app only learns about that through the SNS webhook at
// /api/email/webhooks/ses, which SES only calls when SES_CONFIG_SET names a
// configuration set with an SNS event destination. Without one, SES emails the
// bounce to the sender as a MAILER-DAEMON "Delivery Status Notification
// (Failure)" and the app records nothing — so the address stays on the list and
// bounces again on the next campaign, and the one after that.
//
// This script reads what SES already knows and writes it in, closing the gap
// for sends that have already happened. Fix SES_CONFIG_SET as well, or the gap
// reopens with the next batch of bounces.
//
// Usage:
//   node scripts/import-ses-suppressions.mjs            # every user, apply
//   node scripts/import-ses-suppressions.mjs --dry-run  # report, change nothing
//   node scripts/import-ses-suppressions.mjs user@example.com
//
// Requires in .env.local or .env: MYSQL_*, AWS_ACCESS_KEY_ID,
// AWS_SECRET_ACCESS_KEY, SES_REGION (or AWS_REGION).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import mysql from "mysql2/promise";
import {
  SESv2Client,
  ListSuppressedDestinationsCommand,
} from "@aws-sdk/client-sesv2";

// Dev machines keep credentials in .env.local; the deployed server uses .env.
for (const envFile of [".env.local", ".env"]) {
  try {
    const text = readFileSync(resolve(process.cwd(), envFile), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {}
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const argEmail = (args.find((a) => !a.startsWith("--")) || "").trim().toLowerCase();

if (!process.env.MYSQL_USER) {
  console.error("No MYSQL_USER found. Run from the repo root, where .env.local or .env lives.");
  process.exit(1);
}
if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
  console.error("AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY are not set — nothing to read from SES.");
  process.exit(1);
}

const ses = new SESv2Client({
  region: process.env.SES_REGION || process.env.AWS_REGION || "us-east-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

console.log("Reading the SES account suppression list…");
const suppressed = new Map(); // email -> { reason, lastUpdate }
let nextToken;
do {
  const res = await ses.send(
    new ListSuppressedDestinationsCommand({ PageSize: 1000, NextToken: nextToken })
  );
  for (const d of res.SuppressedDestinationSummaries ?? []) {
    if (!d?.EmailAddress) continue;
    suppressed.set(String(d.EmailAddress).toLowerCase(), {
      reason: String(d.Reason || "BOUNCE"),
      lastUpdate: d.LastUpdateTime ? new Date(d.LastUpdateTime).toISOString().slice(0, 10) : null,
    });
  }
  nextToken = res.NextToken;
} while (nextToken);

console.log(`SES is refusing delivery to ${suppressed.size} address(es).\n`);
if (suppressed.size === 0) process.exit(0);

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
  await conn.end();
  process.exit(2);
}

const allEmails = [...suppressed.keys()];
let grandTotal = 0;
let grandMarked = 0;

for (const u of userRows) {
  // The SES list is per AWS ACCOUNT and shared by every tenant of this app.
  // Only import the addresses THIS user has actually mailed, or one customer's
  // bounced contacts leak into another's suppression list.
  const mine = [];
  for (const chunk of chunks(allEmails, 500)) {
    const ph = chunk.map(() => "?").join(",");
    const [rows] = await conn.query(
      `SELECT DISTINCT LOWER(cr.email) AS email
         FROM campaign_recipients cr
         JOIN campaigns c ON c.id = cr.campaign_id
        WHERE c.user_id = ? AND LOWER(cr.email) IN (${ph})`,
      [u.id, ...chunk]
    );
    for (const r of rows) mine.push(String(r.email));
  }

  if (!mine.length) {
    console.log(`${String(u.email).padEnd(40)}  no matching recipients`);
    continue;
  }

  if (dryRun) {
    const ph = mine.map(() => "?").join(",");
    const [[row]] = await conn.query(
      `SELECT COUNT(*) AS n FROM suppressions
        WHERE user_id = ? AND type = 'email' AND value IN (${ph})
          AND (corrected IS NULL OR corrected = 0)`,
      [u.id, ...mine]
    );
    const already = Number(row?.n || 0);
    console.log(
      `${String(u.email).padEnd(40)}  ${mine.length} SES-suppressed, ${mine.length - already} would be newly blocked`
    );
    continue;
  }

  for (const chunk of chunks(mine, 500)) {
    const placeholders = [];
    const values = [];
    for (const email of chunk) {
      const s = suppressed.get(email);
      placeholders.push("(?, 'email', ?, ?, ?)");
      values.push(
        u.id,
        email,
        `SES account suppression list · ${s.reason}${s.lastUpdate ? ` · ${s.lastUpdate}` : ""}`.slice(0, 255),
        s.reason.toUpperCase() === "COMPLAINT" ? "complaint" : "bounce"
      );
    }
    // Clear `corrected` on a re-import: SES still refusing the address is proof
    // that marking it corrected was wrong, and a corrected row is skipped by
    // loadSuppressionSet — which is exactly how an address keeps getting mailed
    // after it has already bounced.
    await conn.query(
      `INSERT INTO suppressions (user_id, type, value, reason, source)
            VALUES ${placeholders.join(",")}
       ON DUPLICATE KEY UPDATE
            reason       = VALUES(reason),
            source       = VALUES(source),
            corrected    = 0,
            corrected_at = NULL,
            updated_at   = NOW()`,
      values
    );
  }

  // Correct the recipient rows too, so the tracking pages stop counting these
  // sends as successful.
  let marked = 0;
  for (const chunk of chunks(mine, 500)) {
    const ph = chunk.map(() => "?").join(",");
    const [res] = await conn.query(
      `UPDATE campaign_recipients cr
         JOIN campaigns c ON c.id = cr.campaign_id
          SET cr.status        = 'bounced',
              cr.bounced_at    = COALESCE(cr.bounced_at, NOW()),
              cr.error_reason  = COALESCE(cr.error_reason, 'On the SES account suppression list (permanent bounce or complaint)'),
              cr.last_event_at = NOW()
        WHERE c.user_id = ?
          AND LOWER(cr.email) IN (${ph})
          AND cr.status IN ('sent', 'delivered', 'opened', 'clicked')`,
      [u.id, ...chunk]
    );
    marked += Number(res?.affectedRows || 0);
  }

  grandTotal += mine.length;
  grandMarked += marked;
  console.log(
    `${String(u.email).padEnd(40)}  blocked ${mine.length}, re-marked ${marked} recipient row(s) as bounced`
  );
}

console.log(
  dryRun
    ? "\nDry run — nothing was written."
    : `\nDone. ${grandTotal} address(es) blocked, ${grandMarked} recipient row(s) corrected.`
);
console.log(
  "\nThis is a catch-up, not a fix. Set SES_CONFIG_SET to a configuration set with an\n" +
  "SNS event destination (BOUNCE, COMPLAINT, DELIVERY, REJECT) pointing at\n" +
  "<APP_URL>/api/email/webhooks/ses, or the same gap reopens with the next bounce."
);

await conn.end();

function chunks(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
