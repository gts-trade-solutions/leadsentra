/**
 * Shared audience-descriptor parsing for the campaign create + preflight
 * routes.  Both resolve the same `audience` object off the request body, so
 * the normalization rules live here — otherwise the two drift and the
 * "will send to N" preview stops matching what the send actually does.
 */

import { db } from "./db";

/** Same permissive check the upload parser uses — SES is the real authority. */
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;.]+\.[^\s@,;]{2,}$/;

/**
 * The general inboxes of the given companies — info@, sales@, and whatever
 * else is on the record.
 *
 * A campaign audience is built from `contacts`, so it reaches named people and
 * nobody else. Plenty of companies want the shared inbox on the mail too (it's
 * often the address that actually gets read), and there was no way to include
 * it short of adding the inbox as a fake contact.
 *
 * Returns lower-cased, de-duplicated addresses. Chunked because an audience
 * can span thousands of companies and a single IN list that long plans badly.
 */
export async function companyInboxes(companyIds: string[]): Promise<string[]> {
  const ids = Array.from(new Set(companyIds.filter(Boolean)));
  if (!ids.length) return [];

  const found = new Set<string>();
  const CHUNK = 500;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const [rows] = await db.query(
      `SELECT email_general, email_general_2, email_general_3
         FROM companies
        WHERE company_id IN (${slice.map(() => "?").join(",")})`,
      slice
    );
    for (const r of rows as any[]) {
      for (const v of [r.email_general, r.email_general_2, r.email_general_3]) {
        const e = String(v || "").trim().toLowerCase();
        if (e && EMAIL_RE.test(e)) found.add(e);
      }
    }
  }
  return Array.from(found);
}

/**
 * The general inboxes of every company matching a set of audience filters,
 * whether or not anybody is a contact there.
 *
 * {@link companyInboxes} answers "the inboxes of the companies these people
 * work for", which is the right question when the audience is a list of
 * contacts. It cannot reach a company nobody is a contact at, though: with no
 * contact there is no company_id to hand it. An imported company list is
 * mostly like that, so the addresses on it were reachable by no audience mode
 * at all — this resolves companies straight from the filters instead.
 *
 * Visibility follows GET /api/companies exactly: staff see every company, and
 * everyone else sees the ones they own, the legacy/global rows (user_id IS
 * NULL) and any company they are an approved member of. There is no unlock
 * join — an address on the company record is not a contact and there is
 * nothing to unlock when the company has no contacts.
 *
 * Returns lower-cased, de-duplicated addresses.
 */
export async function companyInboxesByFilter(opts: {
  userId: string;
  isStaff: boolean;
  approvedCompanyIds?: string[];
  segments?: string[];
  countries?: string[];
  companyTypes?: string[];
  companyIds?: string[];
  q?: string;
}): Promise<string[]> {
  const where: string[] = [
    // At least one slot filled, or the row cannot be mailed at all.
    `(COALESCE(email_general, '') <> ''
      OR COALESCE(email_general_2, '') <> ''
      OR COALESCE(email_general_3, '') <> '')`,
  ];
  const params: any[] = [];

  if (!opts.isStaff) {
    const visible = ["user_id = ?", "user_id IS NULL"];
    params.push(opts.userId);
    const approved = opts.approvedCompanyIds ?? [];
    if (approved.length) {
      visible.push(`company_id IN (${approved.map(() => "?").join(",")})`);
      params.push(...approved);
    }
    where.push(`(${visible.join(" OR ")})`);
  }

  pushInClause(where, params, "company_id", opts.companyIds ?? []);
  pushInClause(where, params, "segment", opts.segments ?? []);
  pushInClause(where, params, "country", opts.countries ?? []);
  // The importer writes industry and company_type together; the Add Company
  // form writes only industry. COALESCE reads a company's type either way.
  pushInClause(where, params, "COALESCE(industry, company_type)", opts.companyTypes ?? []);

  // The picker's search box. Matched against the company name and the
  // addresses themselves — searching for "@acme.com" is how you find the
  // inbox when you cannot remember what the company is called.
  const q = String(opts.q || "").trim().toLowerCase();
  if (q) {
    where.push(
      `(LOWER(company_name) LIKE ?
        OR LOWER(COALESCE(email_general, '')) LIKE ?
        OR LOWER(COALESCE(email_general_2, '')) LIKE ?
        OR LOWER(COALESCE(email_general_3, '')) LIKE ?)`
    );
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }

  const [rows] = await db.query(
    `SELECT email_general, email_general_2, email_general_3
       FROM companies
      WHERE ${where.join(" AND ")}`,
    params
  );

  const found = new Set<string>();
  for (const r of rows as any[]) {
    for (const v of [r.email_general, r.email_general_2, r.email_general_3]) {
      const e = String(v || "").trim().toLowerCase();
      if (e && EMAIL_RE.test(e)) found.add(e);
    }
  }
  return Array.from(found);
}

/** Matches MAX_EMAILS in /api/campaigns/recipients/parse. */
export const MAX_UPLOADED_EMAILS = 50_000;

/**
 * Accepts either the multi-value key (`segments: string[]`) or the legacy
 * single-value one (`segment: string`), so callers that predate the
 * multi-select filters keep working unchanged.
 */
export function multiFilter(multi: any, single: any): string[] {
  const values = Array.isArray(multi)
    ? multi
    : single !== undefined && single !== null
    ? [single]
    : [];
  return Array.from(
    new Set(
      values
        .filter((x: any) => typeof x === "string")
        .map((x: string) => x.trim())
        .filter(Boolean)
    )
  );
}

/**
 * Builds a `col IN (?, ?)` clause (or `col = ?` for one value) and pushes the
 * bind params. No-ops for an empty list so "no filter" stays "no filter".
 */
export function pushInClause(
  where: string[],
  params: any[],
  column: string,
  values: string[]
): void {
  if (values.length === 1) {
    where.push(`${column} = ?`);
    params.push(values[0]);
  } else if (values.length > 1) {
    where.push(`${column} IN (${values.map(() => "?").join(",")})`);
    params.push(...values);
  }
}

/**
 * Normalizes an uploaded recipient list: lower-cases, drops anything that
 * isn't address-shaped, dedupes, and caps the length.
 *
 * Re-validated here rather than trusted from the parse endpoint's response —
 * the client can post whatever it likes to /api/campaigns directly.
 */
export function normalizeUploadedEmails(input: any): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const value = raw.trim().toLowerCase();
    if (!value || !EMAIL_RE.test(value) || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= MAX_UPLOADED_EMAILS) break;
  }
  return out;
}
