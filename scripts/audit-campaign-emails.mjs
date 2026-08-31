#!/usr/bin/env node
//
// Audit every address a campaign could actually mail, across ALL the columns
// campaigns draw from — not just contacts.email.
//
// Campaign audiences come from companies.email_general / _2 / _3 (see
// companyInboxes in lib/audience.ts), and only sometimes from contacts.email.
// Cleaning contacts alone therefore says nothing about what gets sent: a run
// that reports "1443 checked, 2 fixed" can sit alongside thousands of junk
// company inboxes that are the ones actually bouncing.
//
// This reports what each source holds, classified the same way lib/validate.ts
// cleanEmail classifies it at send time.
//
// Read-only unless --fix-companies is passed, which rewrites only the cells
// whose address can be RECOVERED by decoding (obfuscated addresses stored with
// the encoding intact). Junk is never deleted — it is reported so a human can
// decide, and the audience builder already refuses to mail it.
//
// Usage:
//   node scripts/audit-campaign-emails.mjs
//   node scripts/audit-campaign-emails.mjs --fix-companies

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

const FIX = process.argv.includes("--fix-companies");

// --- mirrors cleanEmail() in lib/validate.ts (plain .mjs cannot import TS) ---
const PLACEHOLDER_RE =
  /^(?:n\.?\/?a\.?|none|nil|null|no|nan|not[\s_-]*provided|not[\s_-]*available|not[\s_-]*found|not[\s_-]*applicable|no[\s_-]+(?:linkedin|phone|url|website|profile|number|email|contact)|unknown|unavailable|tbd|tba|pending|x{2,}|[-–—.,_/\\]+|0+)$/i;
const EMAIL_ENTITIES = { commat: "@", period: ".", amp: "&", hyphen: "-", lowbar: "_", lpar: "(", rpar: ")" };
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
  "domain.com", "domainname.com", "yourdomain.com", "your-domain.com",
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
  if (/%[0-9a-f]{2}/i.test(v)) { try { v = decodeURIComponent(v); } catch {} }
  const q = v.indexOf("?");
  if (q > 0) v = v.slice(0, q);
  return v.replace(/^[\s:;,.<>()\[\]-]+/, "").replace(/[\s:;,.<>()\[\]-]+$/, "").trim();
}
function cleanEmail(value) {
  if (value === undefined || value === null) return { value: null };
  const original = String(value).trim();
  if (!original) return { value: null };
  if (PLACEHOLDER_RE.test(original)) return { value: null };
  const decoded = (decodeEmail(original) || "").toLowerCase();
  if (!decoded || PLACEHOLDER_RE.test(decoded)) return { value: null };
  const bad = (why) => ({ value: null, error: why });
  const at = decoded.indexOf("@");
  if (at < 1 || at !== decoded.lastIndexOf("@") || at === decoded.length - 1) return bad("Invalid email format");
  const local = decoded.slice(0, at);
  const domain = decoded.slice(at + 1);
  if (!EMAIL_SHAPE_RE.test(decoded)) return bad("Invalid email format");
  if (/^\.|\.$|\.\./.test(local) || /^\.|\.$|\.\.|^-|-$/.test(domain)) return bad("Invalid email format");
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

console.log(`\ndatabase: ${process.env.MYSQL_DATABASE}\n`);

const clean = [];
const recoverable = [];
const junk = [];

function classify(where, id, column, raw) {
  const original = String(raw || "").trim();
  if (!original) return;
  const r = cleanEmail(original);
  if (r.error) junk.push({ where, id, column, original, reason: r.error });
  else if (!r.value) return; // placeholder/absent — nothing to mail, nothing wrong
  else if (r.value !== original.toLowerCase()) recoverable.push({ where, id, column, original, fixed: r.value });
  else clean.push(original);
}

// companies.email_general / _2 / _3 — what campaign audiences actually mail.
const [companies] = await conn.query(
  `SELECT company_id, email_general, email_general_2, email_general_3
     FROM companies
    WHERE COALESCE(email_general, '') <> ''
       OR COALESCE(email_general_2, '') <> ''
       OR COALESCE(email_general_3, '') <> ''`
);
for (const c of companies) {
  classify("companies", c.company_id, "email_general", c.email_general);
  classify("companies", c.company_id, "email_general_2", c.email_general_2);
  classify("companies", c.company_id, "email_general_3", c.email_general_3);
}

const [contacts] = await conn.query(
  `SELECT id, email FROM contacts WHERE email IS NOT NULL AND email <> ''`
);
for (const c of contacts) classify("contacts", c.id, "email", c.email);

const total = clean.length + recoverable.length + junk.length;
console.log(`${total} stored address(es) across ${companies.length} company row(s) and ${contacts.length} contact row(s)\n`);
console.log(`  mailable as stored : ${clean.length}`);
console.log(`  recoverable        : ${recoverable.length}   (obfuscated; decode to a real address)`);
console.log(`  unmailable         : ${junk.length}   (can only hard-bounce)\n`);

const show = (list, title, fmt, cap = 20) => {
  if (!list.length) return;
  console.log(`${title} (${list.length})`);
  for (const x of list.slice(0, cap)) console.log(`  ${fmt(x)}`);
  if (list.length > cap) console.log(`  … and ${list.length - cap} more`);
  console.log("");
};

show(recoverable, "Recoverable", (x) => `${x.where}.${x.column}  ${x.original}  ->  ${x.fixed}`);

const byReason = {};
for (const x of junk) (byReason[x.reason] ||= []).push(x);
for (const [reason, list] of Object.entries(byReason)) {
  show(list, `Unmailable — ${reason}`, (x) => `${x.where}.${x.column}  ${x.original}`);
}

// Which domains are contributing the most dead addresses — usually one bad
// scrape run rather than a spread.
if (junk.length) {
  const domains = {};
  for (const x of junk) {
    const d = x.original.split("@")[1];
    if (d) domains[d.toLowerCase()] = (domains[d.toLowerCase()] || 0) + 1;
  }
  const top = Object.entries(domains).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (top.length) {
    console.log("Domains with the most unmailable addresses:");
    for (const [d, n] of top) console.log(`  ${String(n).padStart(5)}  ${d}`);
    console.log("");
  }
}

if (FIX) {
  const companyFixes = recoverable.filter((x) => x.where === "companies");
  for (const x of companyFixes) {
    await conn.query(
      `UPDATE companies SET ${x.column} = ? WHERE company_id = ?`,
      [x.fixed, x.id]
    );
  }
  console.log(`Rewrote ${companyFixes.length} company address(es) to their decoded form.`);
  console.log("Unmailable addresses were left in place — the audience builder");
  console.log("already refuses to mail them, and the raw value may be a human's note.");
  if (recoverable.some((x) => x.where === "contacts")) {
    console.log("\nContact addresses are handled by:  node scripts/clean-contact-emails.mjs --apply");
  }
} else if (recoverable.length || junk.length) {
  console.log("-".repeat(64));
  console.log("Read-only run. Re-run with --fix-companies to rewrite the recoverable ones.");
  console.log("Unmailable addresses need no action: since the audience builder now");
  console.log("filters them, no campaign can send to them whether or not they are stored.");
}

console.log("");
await conn.end();
