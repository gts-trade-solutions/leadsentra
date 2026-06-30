import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import {
  loadOfferWithRoutes,
  loadSellerIdentity,
  loadOfferAssets,
  toOfferPdfData,
} from "@/lib/offerRepo";
import { generateOfferPdf } from "@/lib/offerPdf";
import { resolveBlocksForOffer } from "@/lib/offerTemplatesRepo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/offers/:id/pdf -> the rendered offer PDF.
// ?download=1 forces a save dialog; default is inline (preview in a new tab).
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const found = await loadOfferWithRoutes(session.id, params.id);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const seller = await loadSellerIdentity(session.id);
  const assets = await loadOfferAssets(seller);
  const blocks = await resolveBlocksForOffer(session.id, found.offer.template_id);

  let bytes: Uint8Array;
  try {
    bytes = await generateOfferPdf(toOfferPdfData(found.offer, found.routes, seller), assets, blocks);
  } catch (e: any) {
    console.error("[offers] render failed", e);
    return NextResponse.json({ error: "Could not render the offer PDF." }, { status: 500 });
  }

  const url = new URL(req.url);
  const disposition = url.searchParams.get("download") ? "attachment" : "inline";
  const filename = `${String(found.offer.offer_number).replace(/[^\w.-]+/g, "_")}.pdf`;

  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
