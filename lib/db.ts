import mysql from "mysql2/promise";

// Cache the pool on globalThis so Next.js dev hot-reloads REUSE one pool
// instead of creating a new pool (each up to connectionLimit connections) on
// every recompile — which otherwise leaks connections until MySQL hits
// "Too many connections". In production this just runs once.
const globalForDb = globalThis as unknown as { __mysqlPool?: mysql.Pool };

export const db =
  globalForDb.__mysqlPool ??
  mysql.createPool({
    host: process.env.MYSQL_HOST,
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    namedPlaceholders: false,
    dateStrings: false,
  });

if (process.env.NODE_ENV !== "production") globalForDb.__mysqlPool = db;

export type Row = Record<string, any>;

export async function queryOne<T = Row>(
  sql: string,
  params: any[] = []
): Promise<T | null> {
  const [rows] = await db.execute(sql, params);
  const arr = rows as any[];
  return arr.length ? (arr[0] as T) : null;
}

export async function queryMany<T = Row>(
  sql: string,
  params: any[] = []
): Promise<T[]> {
  const [rows] = await db.execute(sql, params);
  return rows as T[];
}
