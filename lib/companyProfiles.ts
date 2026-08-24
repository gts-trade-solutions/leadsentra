/**
 * Company profiles — the seller identities a user can invoice as.
 *
 * One row of invoice_settings per company: its name, address, tax numbers,
 * bank details, logo, signature and invoice prefix. One is the default, used
 * wherever an invoice doesn't name a company (and by offers).
 *
 * Pure types and helpers only — the SQL lives in lib/companyProfilesRepo.ts —
 * so the invoice form and the settings page can share this file.
 */

/** Editable text columns, in the order the settings form lays them out. */
export const COMPANY_TEXT_FIELDS = [
  "label",
  "seller_company",
  "seller_address",
  "gstin",
  "pan",
  "email",
  "phone",
  "bank_name",
  "bank_account",
  "bank_branch",
  "bank_ifsc",
  "payment_terms",
  "delivery_terms",
  "declaration",
  "signatory_name",
  "invoice_prefix",
] as const;

export type CompanyTextField = (typeof COMPANY_TEXT_FIELDS)[number];

export type CompanyProfile = Record<CompanyTextField, string | null> & {
  id: string;
  is_default: number;
  logo_path: string | null;
  signature_path: string | null;
  created_at?: string;
  updated_at?: string;
};

/** What the picker shows: the given name, else the company, else a placeholder. */
export function companyProfileLabel(p: Partial<CompanyProfile> | null | undefined): string {
  return (
    String(p?.label || "").trim() ||
    String(p?.seller_company || "").trim() ||
    "Untitled company"
  );
}

/** Second line in the picker — enough to tell two entities apart at a glance. */
export function companyProfileSummary(p: CompanyProfile): string {
  const address = String(p.seller_address || "").split(/\r?\n/)[0] || "";
  return [p.gstin, address, p.email].map((v) => String(v || "").trim()).filter(Boolean).join(" · ");
}

/** The "Your company" block on the invoice form. */
export function companySellerFields(p: CompanyProfile) {
  return {
    company: p.seller_company || "",
    address: p.seller_address || "",
    gstin: p.gstin || "",
    pan: p.pan || "",
    email: p.email || "",
    phone: p.phone || "",
  };
}

/** The bank block on the invoice form — a different company banks elsewhere. */
export function companyBankFields(p: CompanyProfile) {
  return {
    name: p.bank_name || "",
    account: p.bank_account || "",
    branch: p.bank_branch || "",
    ifsc: p.bank_ifsc || "",
  };
}

/** Does this profile carry any bank details at all? */
export function hasBankDetails(p: Partial<CompanyProfile> | null | undefined): boolean {
  return [p?.bank_name, p?.bank_account, p?.bank_branch, p?.bank_ifsc].some((v) =>
    String(v || "").trim()
  );
}
