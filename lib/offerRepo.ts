import { db } from "./db";
import { num } from "./invoices";
import { readPublicFile } from "./invoiceUpload";
import type { OfferPdfData, OfferPdfAssets } from "./offerPdf";

/**
 * DB access for LBI offers. Seller identity (company/address/email/bank/logo)
 * is read from invoice_settings + billing_profiles so it stays in one place
 * across invoices and offers.
 *
 * mysql2 returns DECIMAL columns as strings — money fields are coerced with
 * num() so callers always get real numbers.
 */

export type OfferRecord = {
  id: string;
  user_id: string;
  offer_number: string;
  status: string;
  source: string;
  template_id: string | null;
  customer_contact_id: string | null;
  customer_company_id: string | null;
  customer_company: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_address: string | null;
  salutation: string | null;
  subject: string | null;
  cargo_length: string | null;
  cargo_weight: string | null;
  cargo_diameter: string | null;
  survey_timeline: string | null;
  delivery: string | null;
  currency: string;
  tax_rate: number;
  total: number;
  payment_terms: string | null;
  validity_days: number;
  letter_signatory_name: string | null;
  letter_signatory_title: string | null;
  offer_signatory_name: string | null;
  offer_signatory_title: string | null;
  notes: string | null;
  issue_date: string;
  sent_at: string | null;
  created_at: string;
};

export type OfferRouteRecord = { position: number; route_text: string };

/** Format a DATE/DATETIME value (Date or string) to "YYYY-MM-DD". */
function toDateStr(v: any): string {
  if (!v) return "";
  if (v instanceof Date) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(v).slice(0, 10);
}

function mapOffer(row: any): OfferRecord {
  return {
    id: row.id,
    user_id: row.user_id,
    offer_number: row.offer_number,
    status: row.status,
    source: row.source || "generated",
    template_id: row.template_id ?? null,
    customer_contact_id: row.customer_contact_id,
    customer_company_id: row.customer_company_id,
    customer_company: row.customer_company,
    customer_name: row.customer_name,
    customer_email: row.customer_email,
    customer_address: row.customer_address,
    salutation: row.salutation,
    subject: row.subject,
    cargo_length: row.cargo_length,
    cargo_weight: row.cargo_weight,
    cargo_diameter: row.cargo_diameter,
    survey_timeline: row.survey_timeline,
    delivery: row.delivery,
    currency: row.currency || "INR",
    tax_rate: num(row.tax_rate),
    total: num(row.total),
    payment_terms: row.payment_terms,
    validity_days: Number(row.validity_days) || 15,
    letter_signatory_name: row.letter_signatory_name,
    letter_signatory_title: row.letter_signatory_title,
    offer_signatory_name: row.offer_signatory_name,
    offer_signatory_title: row.offer_signatory_title,
    notes: row.notes,
    issue_date: toDateStr(row.issue_date),
    sent_at: row.sent_at ? String(row.sent_at) : null,
    created_at: String(row.created_at),
  };
}

/** Load one offer (scoped to the owning user) with its routes. */
export async function loadOfferWithRoutes(
  userId: string,
  id: string
): Promise<{ offer: OfferRecord; routes: OfferRouteRecord[] } | null> {
  const [rows] = await db.execute(
    "SELECT * FROM offers WHERE id = ? AND user_id = ? LIMIT 1",
    [id, userId]
  );
  const row = (rows as any[])[0];
  if (!row) return null;

  const [routeRows] = await db.execute(
    "SELECT position, route_text FROM offer_routes WHERE offer_id = ? ORDER BY position ASC",
    [id]
  );
  const routes: OfferRouteRecord[] = (routeRows as any[]).map((r) => ({
    position: Number(r.position) || 0,
    route_text: r.route_text,
  }));

  return { offer: mapOffer(row), routes };
}

/** The seller-identity snapshot used to render the letterhead/banking. */
export type SellerIdentity = {
  seller_company: string | null;
  seller_address: string | null;
  seller_email: string | null;
  seller_email2: string | null;
  seller_phone: string | null;
  bank_name: string | null;
  bank_account: string | null;
  bank_branch: string | null;
  bank_ifsc: string | null;
  logo_path: string | null;
  offer_prefix: string | null;
};

/** Read the seller identity from invoice_settings (+ billing profile fallback). */
export async function loadSellerIdentity(userId: string): Promise<SellerIdentity> {
  const [settingsRows, profileRows] = await Promise.all([
    db.execute("SELECT * FROM invoice_settings WHERE user_id = ? LIMIT 1", [userId]),
    db.execute("SELECT company, email, phone, address FROM billing_profiles WHERE user_id = ? LIMIT 1", [userId]),
  ]);
  const s = (settingsRows[0] as any[])[0] || null;
  const p = (profileRows[0] as any[])[0] || null;
  // The settings email field may hold two addresses separated by a comma/newline.
  const emails = String(s?.email || p?.email || "")
    .split(/[\n,;]+/)
    .map((e) => e.trim())
    .filter(Boolean);
  return {
    seller_company: s?.seller_company || p?.company || null,
    seller_address: s?.seller_address || p?.address || null,
    seller_email: emails[0] || null,
    seller_email2: emails[1] || null,
    seller_phone: s?.phone || p?.phone || null,
    bank_name: s?.bank_name || null,
    bank_account: s?.bank_account || null,
    bank_branch: s?.bank_branch || null,
    bank_ifsc: s?.bank_ifsc || null,
    logo_path: s?.logo_path || null,
    offer_prefix: s?.offer_prefix || s?.invoice_prefix || null,
  };
}

/** Read the seller's logo image bytes (if any) for the PDF. */
export async function loadOfferAssets(seller: SellerIdentity): Promise<OfferPdfAssets> {
  const logo = seller.logo_path ? await readPublicFile(seller.logo_path) : null;
  return { logo: logo ? new Uint8Array(logo) : null };
}

/**
 * Map an offer + its routes into the input for createProformaInvoice(): the
 * recipient carries over and the quoted (pre-tax) cost becomes one line item,
 * with the offer's tax rate applied on the invoice and the quote number as ref.
 */
export function offerToInvoiceInput(offer: OfferRecord, routes: OfferRouteRecord[]) {
  const routeList = routes.map((r) => r.route_text).filter(Boolean).join("; ");
  const description = (
    routeList
      ? `Location Based Intelligence (LBI) - Route Survey: ${routeList}`
      : "Location Based Intelligence (LBI) - Route Survey"
  ).slice(0, 512);

  return {
    customer_contact_id: offer.customer_contact_id,
    customer_company_id: offer.customer_company_id,
    customer_name: offer.customer_name,
    customer_email: offer.customer_email,
    customer_company: offer.customer_company,
    customer_address: offer.customer_address,
    currency: offer.currency,
    issue_date: new Date().toISOString().slice(0, 10),
    discount: 0,
    tax_rate: offer.tax_rate,
    ref: offer.offer_number,
    payment_terms: offer.payment_terms,
    notes: `Generated from offer ${offer.offer_number}`,
    items: [
      { part_no: offer.offer_number, description, quantity: 1, unit_price: offer.total },
    ],
  };
}

/** Shape an offer record + routes + seller identity into the PDF renderer's input. */
export function toOfferPdfData(
  offer: OfferRecord,
  routes: OfferRouteRecord[],
  seller: SellerIdentity
): OfferPdfData {
  return {
    offer_number: offer.offer_number,
    issue_date: offer.issue_date,
    currency: offer.currency,

    seller_company: seller.seller_company,
    seller_address: seller.seller_address,
    seller_email: seller.seller_email,
    seller_email2: seller.seller_email2,
    seller_phone: seller.seller_phone,
    bank_name: seller.bank_name,
    bank_account: seller.bank_account,
    bank_branch: seller.bank_branch,
    bank_ifsc: seller.bank_ifsc,
    bank_legal_name: seller.seller_company,

    customer_company: offer.customer_company,
    customer_name: offer.customer_name,
    customer_email: offer.customer_email,
    customer_address: offer.customer_address,
    salutation: offer.salutation,

    subject: offer.subject,
    routes: routes.map((r) => ({ route_text: r.route_text })),
    cargo_length: offer.cargo_length,
    cargo_weight: offer.cargo_weight,
    cargo_diameter: offer.cargo_diameter,

    survey_timeline: offer.survey_timeline,
    delivery: offer.delivery,
    total: offer.total,
    tax_rate: offer.tax_rate,
    payment_terms: offer.payment_terms,
    validity_days: offer.validity_days,

    letter_signatory_name: offer.letter_signatory_name,
    letter_signatory_title: offer.letter_signatory_title,
    offer_signatory_name: offer.offer_signatory_name,
    offer_signatory_title: offer.offer_signatory_title,

    notes: offer.notes,
  };
}
