#!/usr/bin/env node
// Removes an email from contacts + dependent rows AND optionally from
// campaign_recipients history.
// Usage:
//   node scripts/delete-email.mjs <email>                  -> contacts only
//   node scripts/delete-email.mjs <email> --with-history   -> + campaign_recipients

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
const withHistory = process.argv.includes("--with-history");
if (!email) { console.error("Usage: node scripts/delete-email.mjs <email> [--with-history]"); process.exit(1); }

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

try {
  await conn.beginTransaction();

  const [contactRows] = await conn.execute(
    "SELECT id FROM contacts WHERE LOWER(email) = ?",
    [email]
  );
  const ids = contactRows.map((r) => r.id);

  let unlockedCnt = 0, unlocksCnt = 0, contactsCnt = 0;
  if (ids.length) {
    const ph = ids.map(() => "?").join(",");
    [{ affectedRows: unlockedCnt }] = await conn.execute(
      `DELETE FROM unlocked_contacts WHERE contact_id IN (${ph})`, ids
    );
    [{ affectedRows: unlocksCnt }] = await conn.execute(
      `DELETE FROM contacts_unlocks WHERE contact_id IN (${ph})`, ids
    );
    [{ affectedRows: contactsCnt }] = await conn.execute(
      `DELETE FROM contacts WHERE id IN (${ph})`, ids
    );
  }

  let recipCnt = 0;
  if (withHistory) {
    [{ affectedRows: recipCnt }] = await conn.execute(
      "DELETE FROM campaign_recipients WHERE LOWER(email) = ?",
      [email]
    );

    // Re-sync the campaigns.recipients_count column on affected campaigns
    // so the tracking page (Recipients tile) reflects the deletion.
    await conn.execute(`
      UPDATE campaigns ca
         SET recipients_count = (
           SELECT COUNT(*) FROM campaign_recipients WHERE campaign_id = ca.id
         )
       WHERE ca.id IN (
         SELECT DISTINCT campaign_id FROM (
           SELECT campaign_id FROM campaign_recipients WHERE LOWER(email) = ?
         ) t
       )
    `, [email]).catch(() => {});
  }

  await conn.commit();

  console.log(`Removed ${email}:`);
  console.log(`  contacts:            ${contactsCnt} row(s)`);
  console.log(`  unlocked_contacts:   ${unlockedCnt} row(s)`);
  console.log(`  contacts_unlocks:    ${unlocksCnt} row(s)`);
  console.log(`  campaign_recipients: ${recipCnt} row(s)${withHistory ? "" : " (kept — pass --with-history to delete)"}`);
} catch (e) {
  await conn.rollback();
  console.error("Failed:", e.message);
  process.exit(1);
} finally {
  await conn.end();
}
