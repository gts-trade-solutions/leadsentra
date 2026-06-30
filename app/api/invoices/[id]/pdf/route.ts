import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { loadInvoiceWithItems, toPdfData, loadInvoiceAssets } from "@/lib/invoiceRepo";
import { generateInvoicePdf } from "@/lib/invoicePdf";
import { readPublicFile } from "@/lib/invoiceUpload";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/invoices/:id/pdf  -> the rendered PDF (or the uploaded one).
// ?download=1 forces a save dialog; default is inline (preview in a new tab).
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const found = await loadInvoiceWithItems(session.id, params.id);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let bytes: Uint8Array;
  if (found.invoice.source === "upload" && found.invoice.pdf_path) {
    const buf = await readPublicFile(found.invoice.pdf_path);
    if (!buf) return NextResponse.json({ error: "Uploaded PDF not found" }, { status: 404 });
    bytes = new Uint8Array(buf);
  } else {
    const assets = await loadInvoiceAssets(found.invoice);
    bytes = await generateInvoicePdf(toPdfData(found.invoice, found.items), assets);
  }
  const url = new URL(req.url);
  const disposition = url.searchParams.get("download") ? "attachment" : "inline";
  const filename = `${found.invoice.invoice_number}.pdf`;

  return new NextResponse(Buffer.from(bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${disposition}; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
