import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { accessibleCompanyFilter } from "@/lib/memberships";

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
  if (!session) return new Response("Unauthorized", { status: 401 });

  const isAdmin = session.role === "admin";
  let where = "";
  let params: any[] = [];
  if (!isAdmin) {
    const f = await accessibleCompanyFilter(session.id, "c", "co");
    where = `WHERE ${f.sql}`;
    params = f.params;
  }

  const [rows] = await db.execute(
    `SELECT c.id, c.contact_name AS name, c.email, c.title, c.phone,
            c.linkedin_url, c.company_id, co.company_name
       FROM contacts c
       LEFT JOIN companies co ON co.company_id = c.company_id
       ${where}
       ORDER BY c.created_at DESC
       LIMIT 100000`,
    params
  );

  const header = ["id", "name", "email", "title", "phone", "linkedin_url", "company_id", "company_name"];
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
      "Content-Disposition": `attachment; filename="contacts-${ts}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
