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
