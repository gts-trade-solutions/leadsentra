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
  tax_rate: number;
  tax_amount: number;
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
 * Compute invoice totals. Tax is applied to (subtotal - discount).
 * `taxRate` is a percentage (e.g. 18 = 18%).
 */
export function computeTotals(
  items: InvoiceItem[],
  discount: number,
  taxRate: number
): InvoiceTotals {
  const subtotal = money(items.reduce((s, it) => s + it.amount, 0));
  const disc = money(Math.min(Math.max(0, discount), subtotal));
  const tax_rate = Math.max(0, num(taxRate, 0));
  const taxable = Math.max(0, subtotal - disc);
  const tax_amount = money((taxable * tax_rate) / 100);
  const total = money(taxable + tax_amount);
  return { subtotal, discount: disc, tax_rate, tax_amount, total };
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
  // Ensure the counter row exists, then lock + read + bump it.
  await conn.execute(
    `INSERT INTO proforma_invoice_seq (user_id, yr, last_seq)
       VALUES (?, ?, 0)
     ON DUPLICATE KEY UPDATE user_id = user_id`,
    [userId, year]
  );
  const [rows] = await conn.execute(
    "SELECT last_seq FROM proforma_invoice_seq WHERE user_id = ? AND yr = ? FOR UPDATE",
    [userId, year]
  );
  const last = Number((rows as any[])[0]?.last_seq || 0);
  const next = last + 1;
  await conn.execute(
    "UPDATE proforma_invoice_seq SET last_seq = ? WHERE user_id = ? AND yr = ?",
    [next, userId, year]
  );
  const clean = (prefix || "").trim().replace(/[\/]+$/, "");
  if (clean) {
    // e.g. "RIPL/PI" -> "RIPL/PI/2026/09"
    return `${clean}/${year}/${String(next).padStart(2, "0")}`;
  }
  return `PI-${year}-${String(next).padStart(4, "0")}`;
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
