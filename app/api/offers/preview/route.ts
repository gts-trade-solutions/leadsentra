import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { num, money } from "@/lib/invoices";
import { normalizeRoutes, OFFER_DEFAULTS } from "@/lib/offers";
import { loadSellerIdentity, loadOfferAssets } from "@/lib/offerRepo";
import { resolveBlocksForOffer } from "@/lib/offerTemplatesRepo";
import { sanitizeBlocks } from "@/lib/offerTemplate";
import { generateOfferPdf, type OfferPdfData } from "@/lib/offerPdf";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function s(v: unknown, max = 255): string | null {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t ? t.slice(0, max) : null;
}

/**
 * POST /api/offers/preview -> render a PDF from the posted (unsaved) form,
 * applying the same seller-identity snapshot as create, WITHOUT writing to the
 * DB or consuming a quote number. Used by the builder's Preview button.
 */
export async function POST(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const seller = await loadSellerIdentity(session.id);
  const assets = await loadOfferAssets(seller);
  // The template editor sends its unsaved blocks so it can preview live; the
  // offer builder sends a template_id to use a saved template.
  const inlineBlocks = body.template_content ? sanitizeBlocks(body.template_content) : null;
  const blocks =
    inlineBlocks && inlineBlocks.length
      ? inlineBlocks
      : await resolveBlocksForOffer(session.id, s(body.template_id, 36));

  const routes = normalizeRoutes(body.routes);
  const issueDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.issue_date || ""))
    ? String(body.issue_date)
    : new Date().toISOString().slice(0, 10);
  const year = Number(issueDate.slice(0, 4)) || new Date().getFullYear();
  const prefix = (seller.offer_prefix || "").trim().replace(/\/+$/, "");
  const previewNumber =
    s(body.offer_number, 96) || (prefix ? `${prefix}/###/${String(year).slice(2)}-${String(year + 1).slice(2)}` : `LBI-${year}-####`);

  const cur = (s(body.currency, 8) || "INR").toUpperCase();

  const data: OfferPdfData = {
    offer_number: previewNumber,
    issue_date: issueDate,
    currency: cur,

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

    customer_company: s(body.customer_company),
    customer_name: s(body.customer_name),
    customer_email: s(body.customer_email),
    customer_address: s(body.customer_address, 2000),
    salutation: s(body.salutation, 64) || OFFER_DEFAULTS.salutation,

    subject: s(body.subject, 4000),
    routes: routes.map((r) => ({ route_text: r.route_text })),
    cargo_length: s(body.cargo_length, 64),
    cargo_weight: s(body.cargo_weight, 64),
    cargo_diameter: s(body.cargo_diameter, 64),

    survey_timeline: s(body.survey_timeline, 255) || OFFER_DEFAULTS.survey_timeline,
    delivery: s(body.delivery, 255) || OFFER_DEFAULTS.delivery,
    total: money(Math.max(0, num(body.total, 0))),
    tax_rate: Math.max(0, num(body.tax_rate, OFFER_DEFAULTS.tax_rate)),
    payment_terms: s(body.payment_terms, 512) || OFFER_DEFAULTS.payment_terms,
    validity_days: Math.max(1, Math.round(num(body.validity_days, OFFER_DEFAULTS.validity_days))),

    letter_signatory_name: s(body.letter_signatory_name) || OFFER_DEFAULTS.letter_signatory_name,
    letter_signatory_title: s(body.letter_signatory_title) || OFFER_DEFAULTS.letter_signatory_title,
    offer_signatory_name: s(body.offer_signatory_name) || OFFER_DEFAULTS.offer_signatory_name,
    offer_signatory_title: s(body.offer_signatory_title) || OFFER_DEFAULTS.offer_signatory_title,

    notes: s(body.notes, 4000),
  };

  try {
    const bytes = await generateOfferPdf(data, assets, blocks);
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="offer-preview.pdf"',
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    console.error("[offers] preview render failed", e);
    return NextResponse.json({ error: "Could not render preview." }, { status: 500 });
  }
}
