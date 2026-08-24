/**
 * Saved "Bill To" addresses — shared types and pure helpers.
 *
 * Kept free of DB imports (mirroring lib/invoices.ts vs lib/invoiceRepo.ts) so
 * the invoice form and the Manage page can import it in the browser; the SQL
 * lives in lib/billToRepo.ts.
 */

export type BillToAddress = {
  id: string;
  label: string;
  name: string | null;
  company: string | null;
  category: string | null;
  email: string | null;
  phone: string | null;
  gstin: string | null;
  pan: string | null;
  country: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  contact_id: string | null;
  company_id: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
};

/** The editable fields — what the Quick Add / Edit form posts. */
export type BillToInput = Omit<
  BillToAddress,
  "id" | "last_used_at" | "created_at" | "updated_at"
>;

export const BILL_TO_EMPTY: BillToInput = {
  label: "",
  name: "",
  company: "",
  category: "",
  email: "",
  phone: "",
  gstin: "",
  pan: "",
  country: "India",
  address_line1: "",
  address_line2: "",
  city: "",
  state: "",
  pincode: "",
  contact_id: "",
  company_id: "",
};

/** Fields a saved address cannot be without — same list on the form and the API. */
export const BILL_TO_REQUIRED: { key: keyof BillToInput; label: string }[] = [
  { key: "label", label: "Label" },
  { key: "address_line1", label: "Address line 1" },
  { key: "city", label: "City" },
  { key: "state", label: "State" },
];

/** Names the required fields that are still blank, for one clear error message. */
export function missingBillToFields(input: Partial<BillToInput>): string[] {
  return BILL_TO_REQUIRED.filter(({ key }) => !String(input[key] ?? "").trim()).map(
    ({ label }) => label
  );
}

/**
 * Flatten a saved address into the invoice's single "Billing address" box —
 * this is what ends up printed on the PDF, so it is laid out the way an
 * address is written, one part per line:
 *
 *   Street / building
 *   Landmark
 *   City, State - 600032
 *   India
 */
export function composeBillToAddress(a: Partial<BillToAddress>): string {
  const cityLine = [
    [a.city, a.state].map((p) => String(p || "").trim()).filter(Boolean).join(", "),
    String(a.pincode || "").trim() ? `- ${String(a.pincode).trim()}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  return [a.address_line1, a.address_line2, cityLine, a.country]
    .map((p) => String(p || "").trim())
    .filter(Boolean)
    .join("\n");
}

/** One-line summary for the picker dropdown and the "selected" chip. */
export function billToSummary(a: BillToAddress): string {
  return [a.name || a.company, a.email, a.phone, a.city].filter(Boolean).join(" · ");
}

/**
 * Does this address match what was typed? Everything that identifies a
 * customer is searchable — the email above all, since "they choose the email
 * and their details come up" is the whole point of the address book.
 */
export function billToMatches(a: BillToAddress, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [
    a.label,
    a.name,
    a.company,
    a.email,
    a.phone,
    a.gstin,
    a.city,
    a.state,
    a.pincode,
    a.category,
  ].some((f) => String(f || "").toLowerCase().includes(q));
}

/** The customer half of the invoice form, filled in from a saved address. */
export function billToCustomerFields(a: BillToAddress) {
  return {
    contact_id: a.contact_id || "",
    company_id: a.company_id || "",
    // A saved address may hold only a company (a clinic, a dealership); the
    // invoice still needs a name, so the label stands in rather than nothing.
    name: a.name || a.company || a.label || "",
    email: a.email || "",
    phone: a.phone || "",
    company: a.company || "",
    gstin: a.gstin || "",
    pan: a.pan || "",
    address: composeBillToAddress(a),
  };
}
