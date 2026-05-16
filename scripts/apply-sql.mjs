#!/usr/bin/env node
// Apply a .sql migration file against the configured MySQL database.
// Splits on semicolons but is statement-aware enough for typical DDL files.
//
// Usage: node scripts/apply-sql.mjs migrations/<file>.sql

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

const path = process.argv[2];
if (!path) {
  console.error("Usage: node scripts/apply-sql.mjs <file.sql>");
  process.exit(1);
}

const sql = readFileSync(resolve(process.cwd(), path), "utf8");

const conn = await mysql.createConnection({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  multipleStatements: true,
});

try {
  await conn.query(sql);
  console.log(`OK: ${path} applied.`);
} catch (e) {
  console.error(`FAILED: ${e.message}`);
  process.exit(1);
} finally {
  await conn.end();
}
