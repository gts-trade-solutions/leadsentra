#!/usr/bin/env node
// Report which tables this database is missing, and which migration creates
// each one. Read-only — it never writes anything.
//
// Usage: node scripts/db-status.mjs

import { readFileSync, readdirSync } from "node:fs";
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

// What the migrations expect, read from the migration files themselves rather
// than kept by hand: a hand-kept list silently fell behind (the company-profile,
// bill-to and seal migrations were all missing from it), so this reported
// "nothing outstanding" on a database that could not create an invoice.
//
//   * every `CREATE TABLE [IF NOT EXISTS] x` (not TEMPORARY) -> table x
//   * every `ALTER TABLE x ... ADD COLUMN y`, including ones inside a
//     guarded PREPARE string                                   -> column x.y
//
// Files are read in name order, so the first migration that mentions a table
// or column is the one reported for it.
const MIGRATIONS_DIR = resolve(process.cwd(), "migrations");
const EXPECTED = [];
const EXPECTED_COLUMNS = [];
{
  const seenT = new Set();
  const seenC = new Set();
  for (const file of readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    // Drop -- comments so prose like "ALTER TABLE ... ADD COLUMN" in a header
    // is never taken for a statement.
    const sql = readFileSync(resolve(MIGRATIONS_DIR, file), "utf8").replace(/--[^\n]*/g, "");
    for (const m of sql.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?/gi)) {
      const table = m[1].toLowerCase();
      if (!seenT.has(table)) { seenT.add(table); EXPECTED.push([table, file]); }
    }
    // One ALTER statement ends at ";" or, inside a PREPARE string, at "',".
    for (const m of sql.matchAll(/ALTER\s+TABLE\s+`?(\w+)`?([\s\S]*?)(?:;|',)/gi)) {
      const table = m[1].toLowerCase();
      for (const a of m[2].matchAll(/ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?`?(\w+)`?/gi)) {
        const key = `${table}.${a[1].toLowerCase()}`;
        if (!seenC.has(key)) { seenC.add(key); EXPECTED_COLUMNS.push([table, a[1], file]); }
      }
    }
  }
}

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
