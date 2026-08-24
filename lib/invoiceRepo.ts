import { db } from "./db";
import { num } from "./invoices";
import { readPublicFile } from "./invoiceUpload";
import type { InvoicePdfData, InvoicePdfAssets } from "./invoicePdf";

/**
 * DB access for proforma invoices. Kept separate from the pure math/format
 * helpers in lib/invoices.ts so those stay free of DB imports.
 *
 * Note: mysql2 returns DECIMAL columns as strings — every money/quantity field
 * is coerced with num() here so callers always get real numbers.
 */

export type InvoiceRecord = {
  id: string;
  user_id: string;
  invoice_number: string;
  subject: string | null;
  status: string;
  source: string; // generated | upload
  pdf_path: string | null;
  ref: string | null;
  payment_terms: string | null;
  delivery_terms: string | null;
  bank_name: string | null;
  bank_account: string | null;
  bank_branch: string | null;
  bank_ifsc: string | null;
  declaration: string | null;
  signatory_name: string | null;
  logo_path: string | null;
  signature_path: string | null;
  seller_pan: string | null;
  customer_contact_id: string | null;
  customer_company_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
  /** Additional addresses this invoice is emailed to, comma-separated. */
  extra_recipients: string | null;
  customer_phone: string | null;
  customer_company: string | null;
  customer_gstin: string | null;
  customer_pan: string | null;
  customer_address: string | null;
  seller_name: string | null;
  seller_email: string | null;
  seller_phone: string | null;
  seller_company: string | null;
  seller_gstin: string | null;
  seller_address: string | null;
  issue_date: string;
  valid_until: string | null;
  currency: string;
  subtotal: number;
  discount: number;
  tax_rate: number;
  tax_amount: number;
  igst_rate: number;
  igst_amount: number;
  total: number;
  notes: string | null;
  terms: string | null;
  sent_at: string | null;
  created_at: string;
};

export type InvoiceItemRecord = {
  position: number;
  part_no: string | null;
  description: string;
  hsn: string | null;
  quantity: number;
  unit_price: number;
  amount: number;
};

/** Format a DATE/DATETIME value (Date or string) to "YYYY-MM-DD". */
function toDateStr(v: any): string {
  if (!v) return "";
  if (v instanceof Date) {
    // mysql2 parses a DATE column into a JS Date at LOCAL midnight. Using
    // toISOString() here would shift it to UTC and can roll the day back one
    // (e.g. IST). Format from the local components so the date is preserved.
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(v).slice(0, 10);
}

function mapInvoice(row: any): InvoiceRecord {
  return {
    id: row.id,
    user_id: row.user_id,
    invoice_number: row.invoice_number,
    subject: row.subject ?? null,
    status: row.status,
    source: row.source || "generated",
    pdf_path: row.pdf_path,
    ref: row.ref,
    payment_terms: row.payment_terms,
    delivery_terms: row.delivery_terms,
    bank_name: row.bank_name,
    bank_account: row.bank_account,
    bank_branch: row.bank_branch,
    bank_ifsc: row.bank_ifsc,
    declaration: row.declaration,
    signatory_name: row.signatory_name,
    logo_path: row.logo_path,
    signature_path: row.signature_path,
    seller_pan: row.seller_pan,
    customer_contact_id: row.customer_contact_id,
    customer_company_id: row.customer_company_id,
    customer_name: row.customer_name,
    customer_email: row.customer_email,
    extra_recipients: row.extra_recipients ?? null,
    customer_phone: row.customer_phone,
    customer_company: row.customer_company,
    customer_gstin: row.customer_gstin,
    customer_pan: row.customer_pan,
    customer_address: row.customer_address,
    seller_name: row.seller_name,
    seller_email: row.seller_email,
    seller_phone: row.seller_phone,
    seller_company: row.seller_company,
    seller_gstin: row.seller_gstin,
    seller_address: row.seller_address,
    issue_date: toDateStr(row.issue_date),
    valid_until: row.valid_until ? toDateStr(row.valid_until) : null,
    currency: row.currency || "INR",
    subtotal: num(row.subtotal),
    discount: num(row.discount),
    tax_rate: num(row.tax_rate),
    tax_amount: num(row.tax_amount),
    igst_rate: num(row.igst_rate),
    igst_amount: num(row.igst_amount),
    total: num(row.total),
    notes: row.notes,
    terms: row.terms,
    sent_at: row.sent_at ? String(row.sent_at) : null,
    created_at: String(row.created_at),
  };
}

/**
 * Fill in the seller's own details on an invoice that was saved without them.
 *
 * The seller block is snapshotted at create time, so an invoice raised before
 * the company name / address / GSTIN were filled in under Invoice Settings
 * prints an empty "Communication Address" forever — the settings page appears
 * to do nothing. Blanks (and only blanks) are topped up from the current
 * settings and billing profile at read time; anything the invoice already
 * carries is left exactly as it was snapshotted.
 */
async function fillSellerBlanks(userId: string, invoice: InvoiceRecord): Promise<void> {
  const blank = (v: string | null) => !String(v ?? "").trim();
  const wanted: Array<[keyof InvoiceRecord, string, string]> = [
    // [invoice field, invoice_settings column, billing_profiles column]
    ["seller_company", "seller_company", "company"],
    ["seller_name", "", "full_name"],
    ["seller_email", "email", "email"],
    ["seller_phone", "phone", "phone"],
    ["seller_gstin", "gstin", "gstin"],
    ["seller_pan", "pan", ""],
    ["seller_address", "seller_address", "address"],
    ["declaration", "declaration", ""],
    ["signatory_name", "signatory_name", ""],
  ];
  if (!wanted.some(([f]) => blank(invoice[f] as string | null))) return;

  const readOne = async (sql: string) => {
    try {
      const [rows] = await db.execute(sql, [userId]);
      return (rows as any[])[0] || null;
    } catch {
      // Settings are optional, and the table may not be migrated yet.
      return null;
    }
  };
  const [settings, profile] = await Promise.all([
    readOne("SELECT * FROM invoice_settings WHERE user_id = ? LIMIT 1"),
    readOne(
      "SELECT full_name, email, phone, company, gstin, address FROM billing_profiles WHERE user_id = ? LIMIT 1"
    ),
  ]);
  if (!settings && !profile) return;

  for (const [field, settingsCol, profileCol] of wanted) {
    if (!blank(invoice[field] as string | null)) continue;
    const v =
      (settingsCol && settings?.[settingsCol]) || (profileCol && profile?.[profileCol]) || null;
    if (v) (invoice as any)[field] = String(v);
  }
}

/** Load one invoice (scoped to the owning user) with its line items. */
export async function loadInvoiceWithItems(
  userId: string,
  id: string
): Promise<{ invoice: InvoiceRecord; items: InvoiceItemRecord[] } | null> {
  const [rows] = await db.execute(
    "SELECT * FROM proforma_invoices WHERE id = ? AND user_id = ? LIMIT 1",
    [id, userId]
  );
  const row = (rows as any[])[0];
  if (!row) return null;

  const [itemRows] = await db.execute(
    "SELECT position, part_no, description, hsn, quantity, unit_price, amount FROM proforma_invoice_items WHERE invoice_id = ? ORDER BY position ASC",
    [id]
  );
  const items: InvoiceItemRecord[] = (itemRows as any[]).map((r) => ({
    position: Number(r.position) || 0,
    part_no: r.part_no,
    description: r.description,
    hsn: r.hsn,
    quantity: num(r.quantity),
    unit_price: num(r.unit_price),
    amount: num(r.amount),
  }));

  const invoice = mapInvoice(row);
  await fillSellerBlanks(userId, invoice);
  return { invoice, items };
}

/** Read the invoice's logo/signature image bytes (if any) for the PDF. */
export async function loadInvoiceAssets(invoice: InvoiceRecord): Promise<InvoicePdfAssets> {
  const [logo, signature] = await Promise.all([
    invoice.logo_path ? readPublicFile(invoice.logo_path) : Promise.resolve(null),
    invoice.signature_path ? readPublicFile(invoice.signature_path) : Promise.resolve(null),
  ]);
  return {
    logo: logo ? new Uint8Array(logo) : null,
    signature: signature ? new Uint8Array(signature) : null,
  };
}

/** Shape an invoice record + items into the PDF renderer's input. */
export function toPdfData(invoice: InvoiceRecord, items: InvoiceItemRecord[]): InvoicePdfData {
  return {
    invoice_number: invoice.invoice_number,
    subject: invoice.subject,
    status: invoice.status,
    issue_date: invoice.issue_date,
    valid_until: invoice.valid_until,
    currency: invoice.currency,
    seller_company: invoice.seller_company,
    seller_name: invoice.seller_name,
    seller_email: invoice.seller_email,
    seller_phone: invoice.seller_phone,
    seller_gstin: invoice.seller_gstin,
    seller_pan: invoice.seller_pan,
    seller_address: invoice.seller_address,
    ref: invoice.ref,
    payment_terms: invoice.payment_terms,
    delivery_terms: invoice.delivery_terms,
    bank_name: invoice.bank_name,
    bank_account: invoice.bank_account,
    bank_branch: invoice.bank_branch,
    bank_ifsc: invoice.bank_ifsc,
    declaration: invoice.declaration,
    signatory_name: invoice.signatory_name,
    customer_company: invoice.customer_company,
    customer_name: invoice.customer_name,
    customer_email: invoice.customer_email,
    customer_phone: invoice.customer_phone,
    customer_gstin: invoice.customer_gstin,
    customer_pan: invoice.customer_pan,
    customer_address: invoice.customer_address,
    items: items.map((it) => ({
      part_no: it.part_no,
      description: it.description,
      hsn: it.hsn,
      quantity: it.quantity,
      unit_price: it.unit_price,
      amount: it.amount,
    })),
    subtotal: invoice.subtotal,
    discount: invoice.discount,
    tax_rate: invoice.tax_rate,
    tax_amount: invoice.tax_amount,
    igst_rate: invoice.igst_rate,
    igst_amount: invoice.igst_amount,
    total: invoice.total,
    notes: invoice.notes,
    terms: invoice.terms,
  };
}
