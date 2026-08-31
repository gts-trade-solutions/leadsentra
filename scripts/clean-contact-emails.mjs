#!/usr/bin/env node
//
// Find and repair unmailable addresses already stored in `contacts.email`.
//
// The contact import used to check only the address SHAPE, which let two kinds
// of junk through:
//
//   - Addresses the source site had obfuscated to defeat scrapers, stored with
//     the encoding intact: "%20admin@raixen.com", "info&commat;x.com". These
//     are REAL addresses wearing a disguise — they get decoded and kept.
//   - Text that was never an address: "yourname@business.com" copied off a
//     template, Cloudflare anti-scraping tokens like
//     "bde9d296c91c4096b504cee430d9a067@ccsipro.com". These can only ever hard
//     bounce, and every hard bounce is charged against the sending domain's
//     reputation. They get cleared to NULL.
//
// The contact row itself is never deleted — name, company and phone stay, so
// the lead is still workable once someone finds a real address for it.
//
// Every change is written to `contact_email_cleanup_log` first, so any row can
// be restored with a single UPDATE ... JOIN. Nothing here is irreversible.
//
// Usage:
//   node scripts/clean-contact-emails.mjs            # report only, no writes
//   node scripts/clean-contact-emails.mjs --apply    # make the changes
//   node scripts/clean-contact-emails.mjs --undo     # restore from the log

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
const UNDO = process.argv.includes("--undo");

// ---------------------------------------------------------------------------
// Mirrors cleanEmail() in lib/validate.ts. Kept in sync deliberately: this is a
// plain .mjs script and cannot import the TypeScript module.
// ---------------------------------------------------------------------------

const PLACEHOLDER_RE =
  /^(?:n\.?\/?a\.?|none|nil|null|no|nan|not[\s_-]*provided|not[\s_-]*available|not[\s_-]*found|not[\s_-]*applicable|no[\s_-]+(?:linkedin|phone|url|website|profile|number|email|contact)|unknown|unavailable|tbd|tba|pending|x{2,}|[-–—.,_/\\]+|0+)$/i;

const EMAIL_ENTITIES = {
  commat: "@", period: ".", amp: "&", hyphen: "-", lowbar: "_", lpar: "(", rpar: ")",
};

const PLACEHOLDER_LOCALS = new Set([
  "yourname", "your-name", "your_name", "your.name",
  "youremail", "your-email", "your_email", "your.email",
  "yourmail", "youraddress", "enteryouremail", "emailaddress",
  "firstname", "lastname", "firstname.lastname", "first.last",
  "firstname_lastname", "first_last",
  "john.doe", "johndoe", "jane.doe", "janedoe",
  "example", "sample", "placeholder", "dummy",
  "asdf", "qwerty", "xxx", "xxxx", "aaa",
]);

const PLACEHOLDER_DOMAINS = new Set([
  "example.com", "example.net", "example.org", "example.edu",
  "domain.com", "domainname.com",
  "yourdomain.com", "your-domain.com",
  "yourcompany.com", "your-company.com", "mycompany.com", "companyname.com",
  "yourwebsite.com", "yoursite.com", "yourbusiness.com",
]);

const RESERVED_TLDS = new Set(["test", "invalid", "localhost", "example", "local"]);
const EMAIL_SHAPE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function entityChar(code, original) {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return original;
  try { return String.fromCodePoint(code); } catch { return original; }
}

function decodeEmail(value) {
  if (value === undefined || value === null) return null;
  let v = String(value);
  v = v.replace(/&#x([0-9a-f]+);/gi, (m, hex) => entityChar(parseInt(hex, 16), m));
  v = v.replace(/&#(\d+);/g, (m, dec) => entityChar(parseInt(dec, 10), m));
  v = v.replace(/&([a-z]+);/gi, (m, name) => EMAIL_ENTITIES[name.toLowerCase()] ?? m);
  if (/%[0-9a-f]{2}/i.test(v)) {
    try { v = decodeURIComponent(v); } catch {}
  }
  const q = v.indexOf("?");
  if (q > 0) v = v.slice(0, q);
  v = v.replace(/^[\s:;,.<>()\[\]-]+/, "").replace(/[\s:;,.<>()\[\]-]+$/, "");
  return v.trim();
}

/** { value, error } — error means "was meant to be an address but cannot be one". */
function cleanEmail(value) {
  if (value === undefined || value === null) return { value: null };
  const original = String(value).trim();
  if (!original) return { value: null };
  if (PLACEHOLDER_RE.test(original)) return { value: null };

  const decoded = (decodeEmail(original) || "").toLowerCase();
  if (!decoded) return { value: null };
  if (PLACEHOLDER_RE.test(decoded)) return { value: null };

  const bad = (why) => ({ value: null, error: why });

  const at = decoded.indexOf("@");
  if (at < 1 || at !== decoded.lastIndexOf("@") || at === decoded.length - 1) {
    return bad("Invalid email format");
  }
  const local = decoded.slice(0, at);
  const domain = decoded.slice(at + 1);

  if (!EMAIL_SHAPE_RE.test(decoded)) return bad("Invalid email format");
  if (/^\.|\.$|\.\./.test(local) || /^\.|\.$|\.\.|^-|-$/.test(domain)) {
    return bad("Invalid email format");
  }
  // Punctuation alone is never a mailbox: ".+@163.com" strips to "+@163.com".
  if (!/[a-z0-9]/.test(local)) return bad("Invalid email format");
  const tld = domain.slice(domain.lastIndexOf(".") + 1);
  if (!/^[a-z]{2,}$/.test(tld)) return bad("Invalid email domain");
  if (RESERVED_TLDS.has(tld)) return bad("Reserved domain that cannot receive mail");
  if (PLACEHOLDER_DOMAINS.has(domain)) return bad("Placeholder domain");
  if (PLACEHOLDER_LOCALS.has(local)) return bad("Placeholder email address");
  if (/^[0-9a-f]{16,}$/.test(local)) return bad("Obfuscation token, not an address");

  return { value: decoded };
}

// ---------------------------------------------------------------------------

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

await conn.query(`
  CREATE TABLE IF NOT EXISTS contact_email_cleanup_log (
    id          BIGINT       NOT NULL AUTO_INCREMENT,
    contact_id  CHAR(36)     NOT NULL,
    old_email   VARCHAR(255) NOT NULL,
    new_email   VARCHAR(255) NULL,
    action      VARCHAR(16)  NOT NULL,
    reason      VARCHAR(120) NULL,
    created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_cecl_contact (contact_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`);

if (UNDO) {
  const [res] = await conn.query(
    `UPDATE contacts c
       JOIN contact_email_cleanup_log l ON l.contact_id = c.id
        SET c.email = l.old_email
      WHERE (c.email IS NULL AND l.new_email IS NULL)
         OR c.email = l.new_email`
  );
  console.log(`Restored ${res.affectedRows} contact email(s) from the log.`);
  console.log("The log is kept. Drop it with: DROP TABLE contact_email_cleanup_log;");
  await conn.end();
  process.exit(0);
}

const [rows] = await conn.query(
  `SELECT id, email FROM contacts WHERE email IS NOT NULL AND email <> ''`
);
console.log(`Checking ${rows.length} contact email(s)…\n`);

const decoded = [];   // real address, recovered from encoding
const cleared = [];   // never an address, will be NULLed
for (const r of rows) {
  const original = String(r.email);
  const res = cleanEmail(original);
  if (res.error) {
    cleared.push({ id: r.id, email: original, reason: res.error });
  } else if (res.value && res.value !== original.trim().toLowerCase()) {
    decoded.push({ id: r.id, email: original, fixed: res.value });
  }
}

const show = (list, fmt, title, cap = 15) => {
  if (!list.length) return;
  console.log(`${title} (${list.length})`);
  for (const x of list.slice(0, cap)) console.log(`  ${fmt(x)}`);
  if (list.length > cap) console.log(`  … and ${list.length - cap} more`);
  console.log("");
};

show(decoded, (x) => `${x.email}  ->  ${x.fixed}`, "Recoverable — decoded to a real address");

const byReason = {};
for (const x of cleared) (byReason[x.reason] ||= []).push(x);
for (const [reason, list] of Object.entries(byReason)) {
  show(list, (x) => x.email, `Unmailable — ${reason}`);
}

if (!decoded.length && !cleared.length) {
  console.log("Nothing to fix — every stored address is already clean.");
  await conn.end();
  process.exit(0);
}

if (!APPLY) {
  console.log(`${"-".repeat(60)}`);
  console.log(`Would decode ${decoded.length} and clear ${cleared.length}. Nothing written.`);
  console.log("Re-run with --apply to make the changes (reversible with --undo).");
  await conn.end();
  process.exit(0);
}

let fixedCount = 0;
for (const x of decoded) {
  // A decoded address can collide with a contact that already holds it. The
  // unique-per-user rule lives in application code, not a DB constraint, so
  // check rather than assume — and leave the duplicate alone for a human.
  const [[dupe]] = await conn.query(
    `SELECT COUNT(*) AS n FROM contacts c2
       JOIN contacts c1 ON c1.id = ?
      WHERE c2.id <> c1.id AND c2.user_id <=> c1.user_id AND c2.email = ?`,
    [x.id, x.fixed]
  );
  if (Number(dupe?.n || 0) > 0) {
    console.log(`  skipped (duplicate of an existing contact): ${x.email} -> ${x.fixed}`);
    continue;
  }
  await conn.query(
    `INSERT INTO contact_email_cleanup_log (contact_id, old_email, new_email, action, reason)
     VALUES (?, ?, ?, 'decoded', 'recovered from encoding')`,
    [x.id, x.email, x.fixed]
  );
  await conn.query("UPDATE contacts SET email = ? WHERE id = ?", [x.fixed, x.id]);
  fixedCount++;
}

let clearedCount = 0;
for (const x of cleared) {
  await conn.query(
    `INSERT INTO contact_email_cleanup_log (contact_id, old_email, new_email, action, reason)
     VALUES (?, ?, NULL, 'cleared', ?)`,
    [x.id, x.email, x.reason.slice(0, 120)]
  );
  await conn.query("UPDATE contacts SET email = NULL WHERE id = ?", [x.id]);
  clearedCount++;
}

console.log(`${"-".repeat(60)}`);
console.log(`Decoded ${fixedCount} address(es) back to a mailable form.`);
console.log(`Cleared ${clearedCount} address(es) that could never be delivered.`);
console.log("Contact rows were kept — only the email column changed.");
console.log("\nEvery change is in contact_email_cleanup_log.");
console.log("Undo everything:  node scripts/clean-contact-emails.mjs --undo");

await conn.end();
