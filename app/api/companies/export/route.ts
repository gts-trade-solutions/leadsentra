import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET() {
  const session = await getUser();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const isAdmin = session.role === "admin";
  const where = isAdmin ? "" : "WHERE user_id = ? OR user_id IS NULL";
  const params: any[] = isAdmin ? [] : [session.id];

  const [rows] = await db.execute(
    `SELECT company_id AS code, company_name AS name, industry AS type,
            size, website, linkedin, country
       FROM companies
       ${where}
       ORDER BY created_at DESC
       LIMIT 100000`,
    params
  );

  const header = ["code", "name", "type", "size", "website", "linkedin", "country"];
  const out: string[] = [header.join(",")];
  for (const r of rows as any[]) {
    out.push(header.map((h) => csvEscape((r as any)[h])).join(","));
  }
  const body = out.join("\n");
  const ts = new Date().toISOString().slice(0, 10);

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="companies-${ts}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
