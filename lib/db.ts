import mysql from "mysql2/promise";

export const db = mysql.createPool({
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
