import { amountInWords, money } from "./invoices";
import type { OfferPdfData } from "./offerPdf";

/**
 * Offer template model.
 *
 * A template is an ordered list of content BLOCKS. Text blocks may contain
 * {{placeholders}} that are resolved from the offer's dynamic fields at render
 * time, so every template reuses the SAME field set — only the layout/wording
 * changes. The PDF engine (lib/offerPdf.ts) walks these blocks.
 *
 * Templates are stored in the DB (LONGTEXT JSON) and edited in-app. The
 * built-in RACE INTELLECT (LBI) layout below is seeded as each user's default.
 */

/** `label` is an editor-only title to help identify the section. Never rendered in the PDF. */
type WithLabel = { label?: string };

export type OfferBlock = WithLabel &
  (
    | { type: "page_break" }
    | { type: "letterhead" } // logo (left) + seller company/address/email (right)
    | { type: "spacer"; size?: number }
    | { type: "heading"; text: string; level?: 1 | 2 | 3; align?: "left" | "center" }
    | {
        type: "paragraph";
        text: string;
        bold?: boolean;
        italic?: boolean;
        muted?: boolean;
        align?: "left" | "center" | "right";
      }
    | { type: "bullets"; items: string[]; ordered?: boolean } // ordered => a, b, c…
    | { type: "quote_no"; text: string } // right-aligned quote-number line
    | { type: "routes_table" } // Sl / Route / Timeline / Cost
    | { type: "banking" } // seller legal name + bank block
  );

export type OfferTemplate = {
  id: string;
  name: string;
  is_default: boolean;
  content: OfferBlock[];
};

/** Placeholders an admin can use in template text. Shown in the editor. */
export const OFFER_PLACEHOLDERS: Array<{ token: string; label: string }> = [
  { token: "{{date}}", label: "Offer date (e.g. 01st June 2026)" },
  { token: "{{quote_no}}", label: "Quote / offer number" },
  { token: "{{seller_company}}", label: "Your company name" },
  { token: "{{recipient_company}}", label: "Recipient company" },
  { token: "{{attention}}", label: "Kind-attention person" },
  { token: "{{recipient_address}}", label: "Recipient address" },
  { token: "{{recipient_email}}", label: "Recipient email" },
  { token: "{{salutation}}", label: "Salutation (Dear Sir)" },
  { token: "{{subject_routes}}", label: "Route list / reference sentence" },
  { token: "{{cargo_dimensions}}", label: "Cargo L / W / Diameter line" },
  { token: "{{total}}", label: "Total cost (formatted)" },
  { token: "{{amount_in_words}}", label: "Total in words" },
  { token: "{{survey_timeline}}", label: "Survey & report timeline" },
  { token: "{{delivery}}", label: "Delivery time" },
  { token: "{{payment_terms}}", label: "Payment terms" },
  { token: "{{tax_rate}}", label: "Service-tax note %" },
  { token: "{{validity_days}}", label: "Offer validity (days)" },
  { token: "{{letter_signatory_name}}", label: "Cover-letter signatory name" },
  { token: "{{letter_signatory_title}}", label: "Cover-letter signatory title" },
  { token: "{{offer_signatory_name}}", label: "Commercial signatory name" },
  { token: "{{offer_signatory_title}}", label: "Commercial signatory title" },
  { token: "{{notes}}", label: "Free-text notes" },
];

function pdfMoney(amount: number, code: string): string {
  const c = (code || "INR").toUpperCase();
  const locale = c === "INR" ? "en-IN" : "en-US";
  return money(amount).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** YYYY-MM-DD -> "01st June 2026". Falls back to the raw string if unparseable. */
export function fmtLongDate(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  if (!m) return String(s ?? "");
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const day = Number(m[3]);
  const mo = months[Number(m[2]) - 1] || m[2];
  const suffix =
    day % 10 === 1 && day !== 11 ? "st" :
    day % 10 === 2 && day !== 12 ? "nd" :
    day % 10 === 3 && day !== 13 ? "rd" : "th";
  return `${day}${suffix} ${mo} ${m[1]}`;
}

/** Build the placeholder -> value map from an offer's dynamic data. */
export function buildPlaceholderMap(data: OfferPdfData): Record<string, string> {
  const cur = (data.currency || "INR").toUpperCase();
  const dims = [
    data.cargo_length ? `Length: ${data.cargo_length}` : null,
    data.cargo_weight ? `Weight: ${data.cargo_weight}` : null,
    data.cargo_diameter ? `Diameter: ${data.cargo_diameter}` : null,
  ].filter(Boolean).join(", ");
  const subjectRoutes =
    (data.subject && data.subject.trim()) ||
    data.routes.map((r) => r.route_text).filter(Boolean).join("; ");

  return {
    date: fmtLongDate(data.issue_date),
    quote_no: data.offer_number || "",
    seller_company: data.seller_company || "",
    recipient_company: data.customer_company || "",
    attention: data.customer_name || "",
    recipient_address: data.customer_address || "",
    recipient_email: data.customer_email || "",
    salutation: data.salutation || "Dear Sir",
    subject_routes: subjectRoutes,
    cargo_dimensions: dims,
    total: pdfMoney(data.total, cur),
    amount_in_words: amountInWords(data.total, cur),
    survey_timeline: data.survey_timeline || "",
    delivery: data.delivery || "",
    payment_terms: data.payment_terms || "",
    tax_rate: String(data.tax_rate ?? 18),
    validity_days: String(data.validity_days ?? 15),
    letter_signatory_name: data.letter_signatory_name || "",
    letter_signatory_title: data.letter_signatory_title || "",
    offer_signatory_name: data.offer_signatory_name || "",
    offer_signatory_title: data.offer_signatory_title || "",
    notes: data.notes || "",
  };
}

/** Replace {{placeholders}} in a string from the map (unknown tokens -> ""). */
export function fillPlaceholders(text: string, map: Record<string, string>): string {
  return String(text ?? "").replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_m, key) => {
    const v = map[String(key).toLowerCase()];
    return v === undefined ? "" : v;
  });
}

// ---- Built-in RACE INTELLECT (LBI) default template ------------------------

const SCOPE_INTRO =
  "Complete route survey and collection of details to maximum extent from sources for all bridges, culverts, obstacles, turning radius and critical junctions in the below route and analysis of route feasibility and vehicle movability with maximum dimension & weight of cargo through a suitable vehicle will suggest.";

const SCOPE_BULLETS = [
  "Details of states & state border to be passed.",
  "Details of Landmark (City, Petrol Pumps, Toll Gate and Check post).",
  "Details of national highways/state highways numbers.",
  "Details of No Entry Time (Location wise) including no entry restriction during festive season.",
  "Details of rules (state/local bodies) for restriction of movement in this route and type of permission required for vehicle movement with details of concerned authority.",
  "Details of alternate route available in case movement clearance is not available in the main/original route. (Alternate route cost will be extra at the time of survey.)",
  "Details of obstacles/constraints with photographs and suggesting methodology to overcome the constraints e.g.",
  "Railway level crossings (both electrified & non-electrified and those likely to be electrified in near future).",
  "Rail/Road Over Bridge, Foot Over Bridge & Fly overs.",
  "Check post barriers, hoardings, overhead electric lines and other height restrictions.",
  "Congested/Crowded roads and roads with width constraints.",
  "Details of constraints due to turning radius.",
  "High Tension power lines.",
  "All (Railways as well as River-over bridge including critical bridges) - with respect to number of spans with length, type of bridge, weight withstanding capacity of the bridge based on information available at the bridge site or secondary information from the sources around this area; if non feasible, we can offer a possible feasibility in constructing bye-passes to this bridge or other possibilities.",
  "Suitable time (day or night) for movement.",
  "Feasibility report recommending movability of cargo with maximum dimension (as per below details).",
  "Shortest/Feasible route calculation suggesting the transit period and type of vehicle.",
];

const METHODOLOGY = [
  "RACE INTELLECT team will undertake physical survey between point A & point B in a car, with required instrumentation like GPS positioning device, electronic measuring devices etc.,",
  "The team is expected to cover 50 KMs on an average / day, depending on the constraints.",
  "All details will be fed to the RACE TECHNIC team for engineering drawings to evolve vehicle turning simulations on critical turnings.",
  "Complete documentation, Reports, recommendations, Executive summary and Comprehensive survey report will be generated by the INTELLECT team at an average of 50KMs / day.",
  "The accuracy expected will be around 90%.",
];

const TERMS_BULLETS = [
  "Interest on delayed payments: Interest on delayed payments shall be charged at three times the bank rate notified by the Reserve Bank of India (RBI) as per the MSMED Act, 2006.",
  "Force Majeure: The seller shall not be liable for any delay or failure in performance due to events beyond its control, including natural disasters, strikes, governmental actions, or supply chain disruptions.",
  "Governing Law and Jurisdiction: This offer, and any resulting agreement shall be governed by the laws of Chennai, Tamil Nadu.",
  "Taxes and Duties: Any taxes, duties, or levies applicable shall be borne by the buyer unless expressly agreed otherwise.",
  "Acceptance: The buyer must inspect the report upon receipt. Any modifications or revisions to be highlighted within 3 days, else the service rendered will be deemed to be accepted.",
  "Dispute Resolution: Any disputes arising from this agreement shall be referred to MSME council as per applicable law, including the MSMED Act where relevant.",
  "Validity of the offer: {{validity_days}} days from the date of offer made.",
];

/** The blocks that reproduce the original 6-section LBI offer layout. */
export const DEFAULT_LBI_BLOCKS: OfferBlock[] = [
  // Page 1 — cover letter
  { type: "letterhead", label: "Page 1 · Letterhead (logo + your address)" },
  { type: "paragraph", text: "{{date}}", label: "Offer date" },
  { type: "spacer", size: 6, label: "Gap" },
  { type: "paragraph", text: "{{recipient_company}}", bold: true, label: "Recipient — company name" },
  { type: "paragraph", text: "{{recipient_address}}", label: "Recipient — address" },
  { type: "spacer", size: 4, label: "Gap" },
  { type: "paragraph", text: "KIND ATTENTION:  {{attention}}", bold: true, label: "Kind Attention line" },
  { type: "paragraph", text: "{{salutation}}", label: "Salutation (Dear Sir)" },
  { type: "spacer", size: 4, label: "Gap" },
  { type: "paragraph", text: 'Sub: Offer for RACE "INTELLECT" - LOCATION BASED INTELLIGENCE (LBI) - ROUTE SURVEY AS PER THE SCOPE', bold: true, label: "Subject line" },
  { type: "paragraph", text: "Reference to your discussion had with us regarding route survey from {{subject_routes}}.", label: "Reference paragraph (routes)" },
  { type: "paragraph", text: "In this regard we have studied your requirements based on which we have attached our most competitive offer with scope and cost.", label: "Body paragraph" },
  { type: "paragraph", text: "We request you to go through the offer and revert with your response.", label: "Closing line" },
  { type: "spacer", size: 10, label: "Gap" },
  { type: "paragraph", text: "Yours Sincerely", label: "Sign-off" },
  { type: "paragraph", text: "For {{seller_company}}", label: "Company sign-off" },
  { type: "spacer", size: 14, label: "Gap (signature space)" },
  { type: "paragraph", text: "{{letter_signatory_name}}", bold: true, label: "Signatory — name" },
  { type: "paragraph", text: "{{letter_signatory_title}}", muted: true, label: "Signatory — title" },

  // Page 2 — scope of work
  { type: "page_break", label: "── Page 2: Scope of Work ──" },
  { type: "paragraph", text: "Encl: LBI Offer.", muted: true, label: "Enclosure note" },
  { type: "heading", text: "RACE PRODUCT INTELLECT - LOCATION BASED INTELLIGENCE (LBI)", level: 1, label: "Product title" },
  { type: "heading", text: "1.  SCOPE OF WORK", level: 2, label: "Scope of Work heading" },
  { type: "paragraph", text: SCOPE_INTRO, label: "Scope intro paragraph" },
  { type: "paragraph", text: "Proposed dimensions:  Maximum Dimension Cargo Movement: {{cargo_dimensions}}", bold: true, label: "Proposed cargo dimensions" },
  { type: "bullets", items: SCOPE_BULLETS, label: "Scope checklist (bullet points)" },

  // Page 3 — methodology
  { type: "page_break", label: "── Page 3: Methodology ──" },
  { type: "heading", text: "METHODOLOGY:", level: 2, label: "Methodology heading" },
  { type: "bullets", items: METHODOLOGY, ordered: true, label: "Methodology steps (a, b, c…)" },

  // Page 4 — commercial offer
  { type: "page_break", label: "── Page 4: Commercial Offer ──" },
  { type: "heading", text: "LOCATION BASED INTELLIGENCE (LBI) - COMMERCIAL OFFER", level: 2, align: "center", label: "Commercial Offer heading" },
  { type: "quote_no", text: "Quote No. {{quote_no}}", label: "Quote number line" },
  { type: "paragraph", text: "To", bold: true, label: "“To” label" },
  { type: "paragraph", text: "{{recipient_company}}", bold: true, label: "Recipient — company name" },
  { type: "paragraph", text: "{{recipient_address}}", label: "Recipient — address" },
  { type: "paragraph", text: "KIND ATTENTION:  {{attention}}", bold: true, label: "Kind Attention line" },
  { type: "paragraph", text: "{{salutation}}", label: "Salutation" },
  { type: "paragraph", text: "Sub: Offer for the route as per given below routes.", bold: true, label: "Subject line" },
  { type: "paragraph", text: "We are pleased to give below quotation for the above said route survey proposed by you.", label: "Quotation intro line" },
  { type: "routes_table", label: "Route & cost table (auto-filled)" },
  { type: "paragraph", text: "Rupees In words: {{amount_in_words}}", bold: true, label: "Amount in words" },
  { type: "paragraph", text: "Note: Above mentioned payment Service taxes {{tax_rate}}% as applicable at the delivery time. MSME Certification enclosed.", italic: true, muted: true, label: "Tax / MSME note" },
  { type: "paragraph", text: "Payment Terms: {{payment_terms}}", label: "Payment terms" },

  // Page 5 — delivery + banking
  { type: "page_break", label: "── Page 5: Delivery & Banking ──" },
  { type: "paragraph", text: "Delivery : {{delivery}}", label: "Delivery line" },
  { type: "paragraph", text: "Reports will be viewed on our portal with special user id and passwords secured for you and your client.", label: "Portal access note" },
  { type: "paragraph", text: "Total time required for survey and reporting: {{survey_timeline}} approximate from the date of confirmed work or Purchase order. Any additional requirement will be treated with separate commercials and no changes in the current offerings.", label: "Total time note" },
  { type: "paragraph", text: '"RACE" logo would be used in all the reports. Detailed route survey report submitted only PDF format by soft copy downloadable from our online portal against 100% payment clearance.', label: "Reports / logo note" },
  { type: "spacer", size: 6, label: "Gap" },
  { type: "paragraph", text: "Banking:", bold: true, label: "Banking heading" },
  { type: "paragraph", text: "For all Banking purposes we would like you to note our banking details as follows", label: "Banking intro line" },
  { type: "banking", label: "Bank details (auto-filled)" },
  { type: "spacer", size: 12, label: "Gap" },
  { type: "paragraph", text: "Yours Sincerely", bold: true, label: "Sign-off" },
  { type: "paragraph", text: "{{offer_signatory_name}}", bold: true, label: "Signatory — name" },
  { type: "paragraph", text: "{{offer_signatory_title}}", bold: true, muted: true, label: "Signatory — title" },

  // Page 6 — terms & conditions
  { type: "page_break", label: "── Page 6: Terms & Conditions ──" },
  { type: "heading", text: "Important Terms & Conditions:", level: 2, align: "center", label: "Terms & Conditions heading" },
  { type: "bullets", items: TERMS_BULLETS, ordered: true, label: "Terms list (a, b, c…)" },
];

export const DEFAULT_TEMPLATE_NAME = "RACE INTELLECT (LBI) — Route Survey";

const BLOCK_TYPES = new Set([
  "page_break", "letterhead", "spacer", "heading", "paragraph", "bullets", "quote_no", "routes_table", "banking",
]);

/** Validate/clean an untrusted blocks array coming from the editor API. */
export function sanitizeBlocks(raw: unknown): OfferBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: OfferBlock[] = [];
  for (const b of raw) {
    const type = String((b as any)?.type || "");
    if (!BLOCK_TYPES.has(type)) continue;
    const labelRaw = (b as any)?.label;
    const label = typeof labelRaw === "string" && labelRaw.trim() ? labelRaw.trim().slice(0, 120) : undefined;
    let block: OfferBlock | null = null;
    switch (type) {
      case "page_break":
      case "letterhead":
      case "routes_table":
      case "banking":
        block = { type } as OfferBlock;
        break;
      case "spacer":
        block = { type: "spacer", size: Math.max(0, Math.min(80, Number((b as any).size) || 8)) };
        break;
      case "heading": {
        const lvl = Number((b as any).level);
        block = {
          type: "heading",
          text: String((b as any).text || "").slice(0, 600),
          level: (lvl === 1 || lvl === 2 || lvl === 3 ? lvl : 2) as 1 | 2 | 3,
          align: (b as any).align === "center" ? "center" : "left",
        };
        break;
      }
      case "paragraph": {
        const align = (b as any).align;
        block = {
          type: "paragraph",
          text: String((b as any).text || "").slice(0, 4000),
          bold: !!(b as any).bold,
          italic: !!(b as any).italic,
          muted: !!(b as any).muted,
          align: align === "center" || align === "right" ? align : "left",
        };
        break;
      }
      case "bullets": {
        const items = Array.isArray((b as any).items)
          ? (b as any).items.map((s: unknown) => String(s ?? "").slice(0, 2000)).filter((s: string) => s.trim())
          : [];
        block = { type: "bullets", items, ordered: !!(b as any).ordered };
        break;
      }
      case "quote_no":
        block = { type: "quote_no", text: String((b as any).text || "").slice(0, 300) };
        break;
    }
    if (block) {
      if (label) block.label = label;
      out.push(block);
    }
  }
  return out;
}
