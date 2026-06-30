import type { PoolConnection } from "mysql2/promise";

/**
 * LBI route-survey offer domain helpers: shared types and the per-user/per-year
 * quote-number sequence. Money math/format/words helpers are reused from
 * lib/invoices.ts (money, num, amountInWords, formatMoney) so there's one
 * implementation of the Indian numbering system.
 */

export type OfferRouteInput = {
  route_text: string;
};

export type OfferRoute = OfferRouteInput & {
  position: number;
};

export type OfferRecipient = {
  contact_id?: string | null;
  company_id?: string | null;
  company?: string | null;
  name?: string | null; // attention person
  email?: string | null;
  address?: string | null;
};

/** Default contents that match the RACE "INTELLECT" LBI sample offer. */
export const OFFER_DEFAULTS = {
  salutation: "Dear Sir",
  survey_timeline: "4-6 weeks for the completion of survey and reporting",
  delivery: "4-6 weeks",
  payment_terms:
    "60% advance, 20% against survey completion, 20% against report submission on our portal.",
  validity_days: 15,
  tax_rate: 18,
  letter_signatory_name: "Rajesh Khanna",
  letter_signatory_title: "Managing Director",
  offer_signatory_name: "Venkat Manohar",
  offer_signatory_title: "Business Head - LBI (Route survey)",
} as const;

/**
 * Normalise raw route rows from the client. Drops rows with empty text and
 * caps the length, re-numbering positions from 0.
 */
export function normalizeRoutes(raw: unknown): OfferRoute[] {
  if (!Array.isArray(raw)) return [];
  const out: OfferRoute[] = [];
  for (const r of raw) {
    const text =
      typeof r === "string"
        ? r.trim()
        : String((r as any)?.route_text ?? "").trim();
    if (!text) continue;
    out.push({ route_text: text.slice(0, 512), position: out.length });
  }
  return out;
}

/**
 * Build the cover-letter reference sentence from the routes when the user
 * hasn't typed a custom subject — e.g. "ISGEC to Yamunanagar, ... and N other
 * locations." Returns "" when there are no routes.
 */
export function routesToSubject(routes: OfferRoute[]): string {
  const list = routes.map((r) => r.route_text).filter(Boolean);
  if (!list.length) return "";
  return list.join("; ");
}

/**
 * Allocate the next quote number for this user+year when the user left it blank.
 * MUST run inside an open transaction on `conn` — it locks the seq row with
 * FOR UPDATE so concurrent creates can't grab the same number.
 *
 * With a prefix "RIPL/LBI/VK" and year 2026 -> "RIPL/LBI/VK/001/26-27".
 * Without a prefix -> "LBI-2026-0001".
 */
export async function nextOfferNumber(
  conn: PoolConnection,
  userId: string,
  year: number,
  prefix?: string | null
): Promise<string> {
  await conn.execute(
    `INSERT INTO offer_seq (user_id, yr, last_seq)
       VALUES (?, ?, 0)
     ON DUPLICATE KEY UPDATE user_id = user_id`,
    [userId, year]
  );
  const [rows] = await conn.execute(
    "SELECT last_seq FROM offer_seq WHERE user_id = ? AND yr = ? FOR UPDATE",
    [userId, year]
  );
  const last = Number((rows as any[])[0]?.last_seq || 0);
  const next = last + 1;
  await conn.execute(
    "UPDATE offer_seq SET last_seq = ? WHERE user_id = ? AND yr = ?",
    [next, userId, year]
  );

  const clean = (prefix || "").trim().replace(/\/+$/, "");
  if (clean) {
    const yy = String(year).slice(2);
    const fyEnd = String(year + 1).slice(2); // 26-27 style financial-year tail
    return `${clean}/${String(next).padStart(3, "0")}/${yy}-${fyEnd}`;
  }
  return `LBI-${year}-${String(next).padStart(4, "0")}`;
}
