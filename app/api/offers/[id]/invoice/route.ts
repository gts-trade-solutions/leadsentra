import { NextResponse } from "next/server";
import { getUser, HttpError } from "@/lib/auth";
import { loadOfferWithRoutes, offerToInvoiceInput } from "@/lib/offerRepo";
import { createProformaInvoice } from "@/lib/invoiceCreate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/offers/:id/invoice
 * Generate a Proforma Invoice from an offer's details. The offer's combined
 * cost becomes a single line item (the quoted cost is pre-tax, so the offer's
 * tax_rate is applied on the invoice), and the customer + quote reference carry
 * over. Returns the new invoice's id + number.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const found = await loadOfferWithRoutes(session.id, params.id);
  if (!found) return NextResponse.json({ error: "Offer not found" }, { status: 404 });

  const { offer, routes } = found;

  try {
    const created = await createProformaInvoice(session.id, session.email, offerToInvoiceInput(offer, routes));
    return NextResponse.json(created, { status: 201 });
  } catch (e: any) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[offers] generate invoice failed", e);
    return NextResponse.json({ error: "Could not generate the proforma invoice." }, { status: 500 });
  }
}
