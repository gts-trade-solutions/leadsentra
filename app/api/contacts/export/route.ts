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

/**
 * Every contact field the site shows, under the header names the importer
 * accepts, so an export can be edited and re-imported directly.
 *
 * The previous eight columns dropped contact_type, department, location,
 * notes, the Facebook/Instagram links, and the company's country/segment —
 * all of which are visible in the contacts table and its modals.
 *
 * company_name / country / segment come from the joined company and are
 * reference-only: the importer keys on company_id (which also accepts a
 * company name) and ignores headers it doesn't recognise.
 */
const COLUMNS = [
  "id",
  "contact_name",
  "email",
  "title",
  "contact_type",
  "phone",
  "department",
  "location",
  "linkedin_url",
  "facebook_url",
  "instagram_url",
  "notes",
  "company_id",
  "company_name",
  "country",
  "segment",
  "created_at",
] as const;

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
    `SELECT c.id,
            c.contact_name,
            c.email,
            c.title,
            c.contact_type,
            c.phone,
            c.department,
            c.location,
            c.linkedin_url,
            c.facebook_url,
            c.instagram_url,
            c.notes,
            c.company_id,
            co.company_name,
            co.country,
            co.segment,
            c.created_at
       FROM contacts c
       LEFT JOIN companies co ON co.company_id = c.company_id
       ${where}
       ORDER BY c.created_at DESC
       LIMIT 100000`,
    params
  );

  const out: string[] = [COLUMNS.join(",")];
  for (const r of rows as any[]) {
    out.push(COLUMNS.map((h) => csvEscape((r as any)[h])).join(","));
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
