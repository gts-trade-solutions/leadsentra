#!/usr/bin/env node
// Repair company email cells that no campaign can send to.
//
// The companies importer stores an address it cannot validate rather than
// dropping it — a wrong address is still worth a human's correction. Two kinds
// of "wrong" turned out to be nothing of the sort:
//
//   * "a@x.com / b@x.com" — two addresses in one cell. The importer split on
//     commas and semicolons but not on a slash, because a slash is legitimate
//     inside a phone number ("021-555777 / 021-555888"). It is never legitimate
//     inside an email address, so both addresses were kept as one string that
//     matches no format and was mailable as neither.
//   * "&#105;&#110;&#102;&#111;&#64;x.com", "info&commat;x.com", "%69nfo%40x.com"
//     — a site obfuscating its address against scrapers, scraped and stored
//     with the obfuscation intact.
//
// The importer now decodes and splits on the way in (lib/validate.ts
// decodeEmail, EMAIL_SEPARATORS in app/api/companies/import/route.ts). This
// applies the same treatment to rows already stored, so their addresses become
// reachable without waiting for the sheet to be uploaded again.
//
// Usage:
//   node scripts/repair-company-emails.mjs                      # report only
//   node scripts/repair-company-emails.mjs --apply              # write it
//   node scripts/repair-company-emails.mjs --database=leadsentra
//   node scripts/repair-company-emails.mjs --selftest   # no DB, checks decoding
//
// The database comes from MYSQL_DATABASE in .env.local / .env unless
// --database says otherwise, and is printed before anything else: a checkout
// pointed at a scratch database will otherwise report a clean run and tell you
// nothing about the one you meant.
//
// Anything that does not decode into a valid address is left exactly as it is:
// "not publicly confirmed" and "(773) 388-bugs" are not addresses under any
// decoding, and overwriting them would only destroy a human's note.

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

const APPLY = process.argv.includes("--apply");
const dbArg = process.argv.find((a) => a.startsWith("--database="));
const DATABASE = dbArg ? dbArg.slice("--database=".length) : process.env.MYSQL_DATABASE;

if (!DATABASE) {
  console.error("No database. Set MYSQL_DATABASE or pass --database=<name>.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Mirrors lib/validate.ts decodeEmail and the importer's EMAIL_SEPARATORS.
// Inlined because this is a .mjs one-off and those live in TypeScript; it runs
// once, so there is nothing here to drift out of step later.
// ---------------------------------------------------------------------------
const ENTITIES = { commat: "@", period: ".", amp: "&", hyphen: "-", lowbar: "_", lpar: "(", rpar: ")" };
const SEPARATORS = /[,;\n/]+/;
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;.]+\.[^\s@,;]{2,}$/;
const SLOTS = ["email_general", "email_general_2", "email_general_3"];

function entityChar(code, original) {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return original;
  try { return String.fromCodePoint(code); } catch { return original; }
}

function decodeEmail(value) {
  if (value === undefined || value === null) return null;
  let v = String(value);
  v = v.replace(/&#x([0-9a-f]+);/gi, (m, hex) => entityChar(parseInt(hex, 16), m));
  v = v.replace(/&#(\d+);/g, (m, dec) => entityChar(parseInt(dec, 10), m));
  v = v.replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
  if (/%[0-9a-f]{2}/i.test(v)) {
    try { v = decodeURIComponent(v); } catch {}
  }
  const query = v.indexOf("?");
  if (query > 0) v = v.slice(0, query);
  v = v.replace(/^[\s:;,.<>()\[\]-]+/, "").replace(/[\s:;,.<>()\[\]-]+$/, "");
  return v.trim();
}

/** Every address a cell holds, decoded and split. */
function addressesIn(cell) {
  const decoded = decodeEmail(cell);
  if (!decoded) return [];
  return decoded
    .split(SEPARATORS)
    .map((part) => decodeEmail(part))
    .filter((part) => part && EMAIL_RE.test(part));
}

// --selftest runs the decoding above over the malformed values this script was
// written for and prints what each becomes. It touches no database, so the
// logic can be checked from a checkout that cannot reach the server holding the
// data — which is the normal case here: .env.local points at a local scratch
// database, not the one the companies live in.
if (process.argv.includes("--selftest")) {
  const SAMPLES = [
    ["admin@shahilogistics.com / someshshahi@shahilogistics.com", 2],
    ["sales@cargosol.com / cs@cargosol.com", 2],
    ["ask&commat;becktek.ca", 1],
    ["&#105;&#110;&#102;&#111;&#64;&#115;&#97;cred&#98;yte.com", 1],
    ["info@greymatter.com?subject=website enquiry", 1],
    [": salesblr@micronova.in", 1],
    ["%53up%70%6fr%74@my%6e%61%71%2e%63om", 1],
    ["bill%69%6eg%40arc%61n%65%73trategies.com", 1],
    ["&#105;&#110;&#102;&#111;&#064;s&#113;l&#115;&#111;&#108;&#117;&#116;&#105;o&#110;sgro&#117;&#112;&#046;c&#111;m", 1],
    // Not addresses under any decoding — these must come back empty, or the
    // script would overwrite somebody's note with nothing.
    ["not publicly confirmed", 0],
    ["linkedin.com/company/greenh-electrolysis", 0],
    ["(773) 388-bugs", 0],
    ["webmaster", 0],
    ["//", 0],
    ["your@email", 0],
  ];
  let bad = 0;
  for (const [raw, expected] of SAMPLES) {
    const got = addressesIn(raw);
    const ok = got.length === expected;
    if (!ok) bad++;
    console.log(
      `${ok ? "ok  " : "FAIL"} ${JSON.stringify(raw).slice(0, 52).padEnd(54)} -> ` +
      (got.join(" | ") || "(nothing)")
    );
  }
  console.log(bad ? `\n${bad} of ${SAMPLES.length} wrong` : `\nall ${SAMPLES.length} as expected`);
  process.exit(bad ? 1 : 0);
}

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST || "127.0.0.1",
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD || "",
  database: DATABASE,
});

console.log(`Database: ${DATABASE} on ${process.env.MYSQL_HOST || "127.0.0.1"}\n`);

const [rows] = await conn.query(
  `SELECT company_id, company_name, ${SLOTS.join(", ")}
     FROM companies
    WHERE COALESCE(email_general, '') <> ''
       OR COALESCE(email_general_2, '') <> ''
       OR COALESCE(email_general_3, '') <> ''`
);

const repairs = [];
let dropped = 0;

for (const row of rows) {
  const current = SLOTS.map((s) => (row[s] ? String(row[s]).trim() : ""));
  // Nothing to do when every filled slot already holds a valid address.
  if (current.every((v) => !v || EMAIL_RE.test(v))) continue;

  // Pool the row's addresses the way the importer does: in written order,
  // de-duplicated without case, into the three slots.
  const merged = [];
  const seen = new Set();
  for (const cell of current) {
    for (const address of addressesIn(cell)) {
      const key = address.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      if (merged.length < SLOTS.length) merged.push(address);
    }
  }

  // A row whose cells decode to nothing usable keeps them. They are notes, not
  // addresses ("not publicly confirmed"), and are worth more than an empty cell.
  if (!merged.length) { dropped++; continue; }

  const next = SLOTS.map((_, i) => merged[i] ?? null);
  if (SLOTS.every((_, i) => (next[i] ?? "") === current[i])) continue;

  repairs.push({ id: row.company_id, name: row.company_name, from: current, to: next });
}

for (const r of repairs) {
  const from = r.from.filter(Boolean).join(" | ");
  const to = r.to.filter(Boolean).join(" | ");
  console.log(`${r.name}\n  before: ${from}\n  after:  ${to}\n`);
}

const recovered = repairs.reduce((n, r) => n + r.to.filter(Boolean).length, 0);
console.log(
  `${repairs.length} companies repairable -> ${recovered} addresses; ` +
  `${dropped} left alone (no address under any decoding)`
);

if (!APPLY) {
  console.log("\nReport only. Re-run with --apply to write these changes.");
} else {
  for (const r of repairs) {
    await conn.execute(
      `UPDATE companies
          SET email_general = ?, email_general_2 = ?, email_general_3 = ?
        WHERE company_id = ?`,
      [...r.to, r.id]
    );
  }
  console.log(`\nWrote ${repairs.length} companies.`);
}

await conn.end();
