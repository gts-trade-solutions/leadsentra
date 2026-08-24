import type { PoolConnection } from "mysql2/promise";

/**
 * Proforma-invoice domain helpers: shared types, money math, and the
 * per-user/per-year invoice-number sequence.
 *
 * All money is handled as `number` in JS but rounded to 2 decimals before it
 * touches the DB (DECIMAL columns). Quantities allow 3 decimals.
 */

export type InvoiceItemInput = {
  description: string;
  part_no?: string | null;
  hsn?: string | null;
  quantity: number;
  unit_price: number;
};

export type InvoiceItem = InvoiceItemInput & {
  position: number;
  amount: number;
};

export type InvoiceTotals = {
  subtotal: number;
  discount: number;
  tax_rate: number; // GST %
  tax_amount: number; // GST amount
  igst_rate: number; // IGST %
  igst_amount: number; // IGST amount
  total: number;
};

export type SellerInfo = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  gstin?: string | null;
  address?: string | null;
};

export type CustomerInfo = {
  contact_id?: string | null;
  company_id?: string | null;
  name?: string | null;
  email?: string | null;
  company?: string | null;
  gstin?: string | null;
  address?: string | null;
};

/** Round to 2 decimals (money) using a cent-safe rounding. */
export function money(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Coerce arbitrary input to a finite, non-negative number. */
export function num(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Normalise raw line items from the client into priced rows. Drops rows with
 * an empty description. `amount = round(quantity * unit_price)`.
 */
export function normalizeItems(raw: unknown): InvoiceItem[] {
  if (!Array.isArray(raw)) return [];
  const out: InvoiceItem[] = [];
  for (const r of raw) {
    const description = String((r as any)?.description ?? "").trim();
    if (!description) continue;
    const quantity = Math.max(0, num((r as any)?.quantity, 1));
    const unit_price = Math.max(0, num((r as any)?.unit_price, 0));
    const hsnRaw = (r as any)?.hsn;
    const hsn = hsnRaw ? String(hsnRaw).trim() || null : null;
    const partRaw = (r as any)?.part_no;
    const part_no = partRaw ? String(partRaw).trim().slice(0, 128) || null : null;
    out.push({
      description: description.slice(0, 512),
      part_no,
      hsn,
      quantity,
      unit_price,
      position: out.length,
      amount: money(quantity * unit_price),
    });
  }
  return out;
}

/**
 * Compute invoice totals. GST and IGST are independent legs, each applied to
 * (subtotal - discount); both rates are percentages (e.g. 18 = 18%). A domestic
 * intra-state invoice sets GST only, an inter-state one sets IGST only, and
 * leaving either at 0 simply omits that line from the invoice.
 */
export function computeTotals(
  items: InvoiceItem[],
  discount: number,
  taxRate: number,
  igstRate = 0
): InvoiceTotals {
  const subtotal = money(items.reduce((s, it) => s + it.amount, 0));
  const disc = money(Math.min(Math.max(0, discount), subtotal));
  const tax_rate = Math.max(0, num(taxRate, 0));
  const igst_rate = Math.max(0, num(igstRate, 0));
  const taxable = Math.max(0, subtotal - disc);
  const tax_amount = money((taxable * tax_rate) / 100);
  const igst_amount = money((taxable * igst_rate) / 100);
  const total = money(taxable + tax_amount + igst_amount);
  return { subtotal, discount: disc, tax_rate, tax_amount, igst_rate, igst_amount, total };
}

/**
 * Allocate the next invoice number for this user+year, e.g. "PI-2026-0001".
 * MUST run inside an open transaction on `conn` — it locks the seq row with
 * FOR UPDATE so concurrent creates can't grab the same number.
 */
export async function nextInvoiceNumber(
  conn: PoolConnection,
  userId: string,
  year: number,
  prefix?: string | null
): Promise<string> {
  // The counter runs per prefix, so a user invoicing as two companies gets an
  // unbroken series for each instead of one shared series with gaps in both.
  const clean = (prefix || "").trim().replace(/[\/]+$/, "");
  const prefixKey = clean.slice(0, 64);
  const format = (n: number) =>
    clean
      ? // e.g. "RIPL/PI" -> "RIPL/PI/2026/09"
        `${clean}/${year}/${String(n).padStart(2, "0")}`
      : `PI-${year}-${String(n).padStart(4, "0")}`;

  // Ensure the counter row exists, then lock + read + bump it.
  await conn.execute(
    `INSERT INTO proforma_invoice_seq (user_id, prefix_key, yr, last_seq)
       VALUES (?, ?, ?, 0)
     ON DUPLICATE KEY UPDATE user_id = user_id`,
    [userId, prefixKey, year]
  );
  const [rows] = await conn.execute(
    "SELECT last_seq FROM proforma_invoice_seq WHERE user_id = ? AND prefix_key = ? AND yr = ? FOR UPDATE",
    [userId, prefixKey, year]
  );
  const last = Number((rows as any[])[0]?.last_seq || 0);

  // Skip numbers already issued. A counter that starts fresh — a new company,
  // or a prefix used before the per-prefix counters existed — can otherwise
  // land on a number the user already has, and (user_id, invoice_number) is
  // unique, so the whole invoice would fail to save.
  let next = last;
  let number = format(next + 1);
  for (let i = 0; i < 200; i++) {
    next += 1;
    number = format(next);
    const [taken] = await conn.execute(
      "SELECT 1 FROM proforma_invoices WHERE user_id = ? AND invoice_number = ? LIMIT 1",
      [userId, number]
    );
    if (!(taken as any[]).length) break;
  }

  await conn.execute(
    "UPDATE proforma_invoice_seq SET last_seq = ? WHERE user_id = ? AND prefix_key = ? AND yr = ?",
    [next, userId, prefixKey, year]
  );
  return number;
}

/**
 * How many addresses one proforma invoice may be emailed to at once. Enough
 * for billing + procurement + the person who asked for it; low enough that the
 * send never turns into a mailshot.
 */
export const MAX_INVOICE_RECIPIENTS = 10;

/** Email shape test, kept here so this module stays free of DB imports — it is
 *  bundled into the client-side invoice builder. Mirrors lib/suppressions. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Split a recipient list — "billing@x.com, buyer@x.com; ops@x.com", or an
 * array — into lower-cased, de-duplicated addresses, keeping anything that
 * isn't address-shaped so the caller can name the entry that's wrong rather
 * than silently dropping it.
 */
export function parseRecipients(raw: unknown): { valid: string[]; invalid: string[] } {
  const parts = (Array.isArray(raw) ? raw : String(raw ?? "").split(/[,;\s]+/))
    .flatMap((t) => String(t ?? "").split(/[,;\s]+/))
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const p of parts) {
    if (!EMAIL_RE.test(p)) invalid.push(p);
    else if (!valid.includes(p)) valid.push(p);
  }
  return { valid, invalid };
}

/** Currency symbol for the small set we surface in the UI. */
export function currencySymbol(code: string): string {
  switch ((code || "INR").toUpperCase()) {
    case "INR":
      return "₹";
    case "USD":
      return "$";
    case "EUR":
      return "€";
    case "GBP":
      return "£";
    default:
      return "";
  }
}

/**
 * Convert a number to words using the Indian numbering system
 * (thousand / lakh / crore), e.g. 236000 -> "Two Lakh Thirty Six Thousand".
 * Handles paise as "and <n>/100" when there's a fractional part.
 */
export function amountInWords(amount: number, currency = "INR"): string {
  const ones = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
    "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
    "Seventeen", "Eighteen", "Nineteen",
  ];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  const twoDigits = (n: number): string => {
    if (n < 20) return ones[n];
    const t = Math.floor(n / 10);
    const o = n % 10;
    return tens[t] + (o ? ` ${ones[o]}` : "");
  };
  const threeDigits = (n: number): string => {
    const h = Math.floor(n / 100);
    const r = n % 100;
    return (h ? `${ones[h]} Hundred${r ? " " : ""}` : "") + (r ? twoDigits(r) : "");
  };

  const rounded = money(Math.abs(amount));
  let rupees = Math.floor(rounded);
  const paise = Math.round((rounded - rupees) * 100);

  if (rupees === 0 && paise === 0) return "Zero";

  const parts: string[] = [];
  const crore = Math.floor(rupees / 10000000);
  rupees %= 10000000;
  const lakh = Math.floor(rupees / 100000);
  rupees %= 100000;
  const thousand = Math.floor(rupees / 1000);
  rupees %= 1000;
  const hundred = rupees;

  if (crore) parts.push(`${threeDigits(crore)} Crore`);
  if (lakh) parts.push(`${twoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${twoDigits(thousand)} Thousand`);
  if (hundred) parts.push(threeDigits(hundred));

  let words = parts.join(" ").replace(/\s+/g, " ").trim();
  if (paise) {
    words += ` and ${twoDigits(paise)} Paise`;
  }
  const unit = (currency || "INR").toUpperCase() === "INR" ? "Rupees" : (currency || "").toUpperCase();
  return `${unit} ${words} Only`.replace(/\s+/g, " ").trim();
}

/** Format a money amount as "<symbol>1,234.56" (en-IN grouping for INR). */
export function formatMoney(amount: number, code = "INR"): string {
  const sym = currencySymbol(code);
  const locale = (code || "INR").toUpperCase() === "INR" ? "en-IN" : "en-US";
  const n = money(amount).toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return sym ? `${sym}${n}` : `${n} ${code}`;
}
