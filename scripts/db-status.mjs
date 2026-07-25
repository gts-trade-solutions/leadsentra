#!/usr/bin/env node
// Report which tables this database is missing, and which migration creates
// each one. Read-only — it never writes anything.
//
// Usage: node scripts/db-status.mjs

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

// table -> the migration that creates it, in the order they must be applied.
const EXPECTED = [
  ["suppressions", "2026-05-12_suppressions.sql"],
  ["company_segments", "2026-05-13_segments.sql"],
  ["company_catalogues", "2026-06-23_company_catalogues.sql"],
  ["mail_accounts", "2026-06-23_mail_accounts.sql"],
  ["proforma_invoices", "2026-06-24_proforma_invoices.sql"],
  ["proforma_invoice_items", "2026-06-24_proforma_invoices.sql"],
  ["proforma_invoice_seq", "2026-06-24_proforma_invoices.sql"],
  ["invoice_settings", "2026-06-24_proforma_invoices_v2.sql"],
  ["company_memberships", "2026-06-29_company_memberships.sql"],
  ["offer_templates", "2026-06-29_offer_templates.sql"],
  ["offers", "2026-06-29_offers.sql"],
  ["offer_routes", "2026-06-29_offers.sql"],
  ["orders", "2026-06-29_orders.sql"],
];

// Columns added by later migrations to tables that already exist.
const EXPECTED_COLUMNS = [
  ["proforma_invoices", "subject", "2026-07-25_pi_subject_igst.sql"],
  ["proforma_invoices", "igst_rate", "2026-07-25_pi_subject_igst.sql"],
  ["proforma_invoices", "bank_name", "2026-06-24_proforma_invoices_v2.sql"],
  ["contacts", "contact_type", "2026-07-18_contact_type.sql"],
  ["companies", "facebook_url", "2026-07-18_company_socials.sql"],
  ["company_catalogues", "button_label", "2026-07-18_catalogue_button_label.sql"],
];

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
});

try {
  const [rows] = await conn.query(
    "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ?",
    [process.env.MYSQL_DATABASE]
  );
  const present = new Set(rows.map((r) => String(r.t || r.T || r.table_name).toLowerCase()));

  const missingTables = EXPECTED.filter(([t]) => !present.has(t.toLowerCase()));

  const missingColumns = [];
  for (const [table, column, migration] of EXPECTED_COLUMNS) {
    if (!present.has(table.toLowerCase())) continue; // whole table is missing already
    const [cols] = await conn.query(
      "SELECT 1 FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ?",
      [process.env.MYSQL_DATABASE, table, column]
    );
    if (!cols.length) missingColumns.push([`${table}.${column}`, migration]);
  }

  console.log(`Database: ${process.env.MYSQL_DATABASE} (${present.size} tables)\n`);

  if (!missingTables.length && !missingColumns.length) {
    console.log("Everything expected is present. No migrations outstanding.");
  } else {
    if (missingTables.length) {
      console.log("MISSING TABLES:");
      for (const [t, m] of missingTables) console.log(`  ${t.padEnd(24)} -> ${m}`);
      console.log("");
    }
    if (missingColumns.length) {
      console.log("MISSING COLUMNS:");
      for (const [c, m] of missingColumns) console.log(`  ${c.padEnd(34)} -> ${m}`);
      console.log("");
    }
    const order = [...new Set([...missingTables.map((x) => x[1]), ...missingColumns.map((x) => x[1])])].sort();
    console.log("Apply in this order:");
    for (const m of order) console.log(`  node scripts/apply-sql.mjs migrations/${m}`);
  }
} finally {
  await conn.end();
}
