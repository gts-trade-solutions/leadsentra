import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { normalizeItems, computeTotals, num } from "@/lib/invoices";
import { generateInvoicePdf, type InvoicePdfData } from "@/lib/invoicePdf";
import { readPublicFile } from "@/lib/invoiceUpload";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function s(v: unknown, max = 255): string | null {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t ? t.slice(0, max) : null;
}

/**
 * POST /api/invoices/preview  -> renders a PDF from the posted (unsaved) form,
 * applying the same seller/settings snapshot rules as create, WITHOUT writing
 * to the DB or consuming an invoice number. Used by the builder's Preview.
 */
export async function POST(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));

  const [profileRows, settingsRows] = await Promise.all([
    db.execute("SELECT full_name, email, phone, company, gstin, address FROM billing_profiles WHERE user_id = ? LIMIT 1", [session.id]),
    db.execute("SELECT * FROM invoice_settings WHERE user_id = ? LIMIT 1", [session.id]),
  ]);
  const profile = (profileRows[0] as any[])[0] || null;
  const settings = (settingsRows[0] as any[])[0] || null;

  const items = normalizeItems(body.items);
  const discount = Math.max(0, num(body.discount, 0));
  const taxRate = Math.max(0, num(body.tax_rate, 0));
  const totals = computeTotals(items, discount, taxRate);

  const issueDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.issue_date || ""))
    ? String(body.issue_date)
    : new Date().toISOString().slice(0, 10);
  const year = Number(issueDate.slice(0, 4)) || new Date().getFullYear();
  const prefix = (settings?.invoice_prefix || "").trim().replace(/\/+$/, "");
  const previewNumber = prefix ? `${prefix}/${year}/##` : `PI-${year}-####`;

  const data: InvoicePdfData = {
    invoice_number: previewNumber,
    status: "preview",
    issue_date: issueDate,
    valid_until: /^\d{4}-\d{2}-\d{2}$/.test(String(body.valid_until || "")) ? String(body.valid_until) : null,
    currency: (s(body.currency, 8) || "INR").toUpperCase(),

    seller_company: s(body.seller_company) ?? (settings?.seller_company || profile?.company || null),
    seller_name: s(body.seller_name) ?? (profile?.full_name || session.email || null),
    seller_email: s(body.seller_email) ?? (settings?.email || profile?.email || session.email || null),
    seller_phone: s(body.seller_phone, 64) ?? (settings?.phone || profile?.phone || null),
    seller_gstin: s(body.seller_gstin, 32) ?? (settings?.gstin || profile?.gstin || null),
    seller_pan: s(body.seller_pan, 32) ?? (settings?.pan || null),
    seller_address: s(body.seller_address, 2000) ?? (settings?.seller_address || profile?.address || null),

    ref: s(body.ref, 255),
    payment_terms: s(body.payment_terms, 512) ?? (settings?.payment_terms || null),
    delivery_terms: s(body.delivery_terms, 255) ?? (settings?.delivery_terms || null),

    bank_name: s(body.bank_name) ?? (settings?.bank_name || null),
    bank_account: s(body.bank_account, 64) ?? (settings?.bank_account || null),
    bank_branch: s(body.bank_branch) ?? (settings?.bank_branch || null),
    bank_ifsc: s(body.bank_ifsc, 32) ?? (settings?.bank_ifsc || null),

    customer_company: s(body.customer_company),
    customer_name: s(body.customer_name),
    customer_email: s(body.customer_email),
    customer_gstin: s(body.customer_gstin, 32),
    customer_address: s(body.customer_address, 2000),

    items: items.map((it) => ({
      part_no: it.part_no,
      description: it.description,
      hsn: it.hsn,
      quantity: it.quantity,
      unit_price: it.unit_price,
      amount: it.amount,
    })),

    subtotal: totals.subtotal,
    discount: totals.discount,
    tax_rate: totals.tax_rate,
    tax_amount: totals.tax_amount,
    total: totals.total,

    notes: s(body.notes, 4000),
    terms: s(body.terms, 4000),
    declaration: s(body.declaration, 2000) ?? (settings?.declaration || null),
    signatory_name: s(body.signatory_name) ?? (settings?.signatory_name || null),
  };

  const [logoBuf, sigBuf] = await Promise.all([
    settings?.logo_path ? readPublicFile(settings.logo_path) : Promise.resolve(null),
    settings?.signature_path ? readPublicFile(settings.signature_path) : Promise.resolve(null),
  ]);

  try {
    const bytes = await generateInvoicePdf(data, {
      logo: logoBuf ? new Uint8Array(logoBuf) : null,
      signature: sigBuf ? new Uint8Array(sigBuf) : null,
    });
    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="preview.pdf"',
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    console.error("[invoices] preview render failed", e);
    return NextResponse.json({ error: "Could not render preview." }, { status: 500 });
  }
}
