import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { isStaff } from "@/lib/admin";
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

/** The location the page displays: column first, legacy meta JSON as fallback. */
const LOCATION_EXPR =
  "COALESCE(c.location, JSON_UNQUOTE(JSON_EXTRACT(c.meta, '$.location')))";

/**
 * GET /api/contacts/export
 *
 * With no query params this exports every accessible contact (unchanged).
 *
 * The contacts table filters client-side, so the export used to ignore those
 * filters entirely and hand back the whole book — "I picked a segment and got
 * everything".  These params mirror the on-screen filters one for one and are
 * applied in SQL, so the file matches the table and isn't limited to the rows
 * the page happened to load:
 *
 *   q            search across name / title / company / location
 *   title        repeatable — chosen titles
 *   titleOthers  "1" when the synthetic "Others" bucket is selected
 *   notTitle     repeatable — the popular titles that "Others" excludes
 *   company      repeatable — company names
 *   country      repeatable
 *   segment      repeatable
 *   type         repeatable — company type
 *   from / to    created_at bounds, YYYY-MM-DD inclusive
 *   status       'locked' | 'unlocked'
 *   cf_*         per-column header filters (name, email, title, company,
 *                phone, linkedin_url); a lone "-" means "field is empty"
 */
export async function GET(req: Request) {
  return handle(new URL(req.url).searchParams);
}

/**
 * POST /api/contacts/export
 *
 * Same filters, sent as a urlencoded body. The Company/Title multi-selects can
 * hold hundreds of values ("Select all" is one click), which would overflow a
 * GET query string, so the page posts instead and downloads the response blob.
 */
export async function POST(req: Request) {
  const body = await req.text();
  return handle(new URLSearchParams(body));
}

async function handle(qs: URLSearchParams) {
  const session = await getUser();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const list = (key: string) =>
    qs.getAll(key).map((s) => s.trim()).filter(Boolean);
  const one = (key: string) => (qs.get(key) || "").trim();

  const isAdmin = session.role === "admin";
  const where: string[] = [];
  const params: any[] = [];

  if (!isAdmin) {
    const f = await accessibleCompanyFilter(session.id, "c", "co");
    where.push(f.sql);
    params.push(...f.params);
  }

  const q = one("q");
  if (q) {
    const like = `%${q}%`;
    where.push(
      `(c.contact_name LIKE ? OR c.title LIKE ? OR co.company_name LIKE ? OR ${LOCATION_EXPR} LIKE ?)`
    );
    params.push(like, like, like, like);
  }

  // Title: named titles OR the "Others" bucket (any title outside the popular
  // list the page computed).  With no popular list "Others" means everything,
  // so the clause is dropped rather than emitting an invalid `NOT IN ()`.
  const rawTitles = list("title");
  const titles = rawTitles.filter((t) => t !== "Others");
  const wantsOthers = one("titleOthers") === "1" || rawTitles.includes("Others");
  const notTitles = list("notTitle");
  const othersUnbounded = wantsOthers && notTitles.length === 0;
  if (!othersUnbounded) {
    const titleOr: string[] = [];
    if (titles.length) {
      titleOr.push(`c.title IN (${titles.map(() => "?").join(",")})`);
      params.push(...titles);
    }
    if (wantsOthers) {
      titleOr.push(
        `COALESCE(c.title, '') NOT IN (${notTitles.map(() => "?").join(",")})`
      );
      params.push(...notTitles);
    }
    if (titleOr.length) where.push(`(${titleOr.join(" OR ")})`);
  }

  const inList = (col: string, values: string[]) => {
    if (!values.length) return;
    where.push(`${col} IN (${values.map(() => "?").join(",")})`);
    params.push(...values);
  };
  inList("co.company_name", list("company"));
  inList("co.country", list("country"));
  inList("co.segment", list("segment"));
  inList("COALESCE(co.company_type, co.industry)", list("type"));

  const from = one("from");
  const to = one("to");
  if (from) { where.push("c.created_at >= ?"); params.push(`${from} 00:00:00`); }
  if (to)   { where.push("c.created_at <= ?"); params.push(`${to} 23:59:59`); }

  // Locked / unlocked mirrors the list API: staff see everything as unlocked,
  // everyone else is judged by their own unlocked_contacts rows.
  const status = one("status").toLowerCase();
  if (status === "locked" || status === "unlocked") {
    if (isStaff(session.role)) {
      // Nothing is locked for staff, so "locked" can only be empty.
      if (status === "locked") where.push("1=0");
    } else {
      const exists =
        "EXISTS (SELECT 1 FROM unlocked_contacts uc WHERE uc.contact_id = c.id AND uc.user_id = ?)";
      where.push(status === "unlocked" ? exists : `NOT ${exists}`);
      params.push(session.id);
    }
  }

  // Per-column header filters.  "-" is the page's one-keystroke shortcut for
  // "this field is empty"; anything else is a contains match.
  const COLUMN_FILTERS: Record<string, string> = {
    cf_name: "c.contact_name",
    cf_email: "c.email",
    cf_title: "c.title",
    cf_company: "co.company_name",
    cf_phone: "c.phone",
    cf_linkedin_url: "c.linkedin_url",
  };
  for (const [key, col] of Object.entries(COLUMN_FILTERS)) {
    const v = one(key);
    if (!v) continue;
    if (v === "-") {
      where.push(`(${col} IS NULL OR ${col} = '')`);
    } else {
      where.push(`${col} LIKE ?`);
      params.push(`%${v}%`);
    }
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

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
       ${whereSql}
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
