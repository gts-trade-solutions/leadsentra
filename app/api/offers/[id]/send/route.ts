import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { isEmailShape } from "@/lib/suppressions";
import {
  loadOfferWithRoutes,
  loadSellerIdentity,
  loadOfferAssets,
  toOfferPdfData,
  offerToInvoiceInput,
} from "@/lib/offerRepo";
import { resolveBlocksForOffer } from "@/lib/offerTemplatesRepo";
import { generateOfferPdf } from "@/lib/offerPdf";
import { createProformaInvoice } from "@/lib/invoiceCreate";
import { sendEmail } from "@/lib/emailProvider";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Verified sender identity (default first), else env fallback. */
async function resolveSender(userId: string): Promise<{ email: string; name?: string } | null> {
  const [rows] = await db.execute(
    `SELECT email, display_name FROM email_identities
      WHERE user_id = ? AND status = 'verified'
      ORDER BY is_default DESC, updated_at DESC LIMIT 1`,
    [userId]
  );
  const row = (rows as any[])[0];
  if (row?.email) return { email: row.email, name: row.display_name || undefined };
  const envFrom = process.env.DEFAULT_FROM_EMAIL || process.env.EMAIL_FROM;
  if (envFrom) {
    const m = envFrom.match(/<([^>]+)>/);
    const email = (m ? m[1] : envFrom).trim();
    const name = m ? envFrom.replace(/<[^>]+>/, "").trim().replace(/(^"|"$)/g, "") : undefined;
    if (isEmailShape(email)) return { email, name: name || undefined };
  }
  return null;
}

/** If a PI was already generated from this offer (ref = offer number), reuse it. */
async function existingInvoiceNumber(userId: string, offerNumber: string): Promise<string | null> {
  const [rows] = await db.execute(
    "SELECT invoice_number FROM proforma_invoices WHERE user_id = ? AND ref = ? ORDER BY created_at ASC LIMIT 1",
    [userId, offerNumber]
  );
  const row = (rows as any[])[0];
  return row?.invoice_number || null;
}

/**
 * POST /api/offers/:id/send
 * Emails the offer PDF to the recipient, marks the offer as sent, and then
 * AUTOMATICALLY generates a Proforma Invoice from it (deduped — re-sending an
 * offer that already has a PI won't create another).
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const found = await loadOfferWithRoutes(session.id, params.id);
  if (!found) return NextResponse.json({ error: "Offer not found" }, { status: 404 });
  const { offer, routes } = found;

  const body = await req.json().catch(() => ({}));
  const to = String(body.to || offer.customer_email || "").trim().toLowerCase();
  if (!isEmailShape(to)) {
    return NextResponse.json({ error: "A valid recipient email is required to send the offer." }, { status: 400 });
  }

  const sender = await resolveSender(session.id);
  if (!sender) {
    return NextResponse.json(
      { error: "No verified sender address. Verify a sender under Email settings, or set DEFAULT_FROM_EMAIL." },
      { status: 400 }
    );
  }

  // Persist the recipient if it changed/was missing.
  if (to !== (offer.customer_email || "").toLowerCase()) {
    await db.execute("UPDATE offers SET customer_email = ? WHERE id = ? AND user_id = ?", [to, params.id, session.id]);
    offer.customer_email = to;
  }

  // Render the offer PDF.
  let pdfBase64: string;
  try {
    const seller = await loadSellerIdentity(session.id);
    const assets = await loadOfferAssets(seller);
    const blocks = await resolveBlocksForOffer(session.id, offer.template_id);
    const bytes = await generateOfferPdf(toOfferPdfData(offer, routes, seller), assets, blocks);
    pdfBase64 = Buffer.from(bytes).toString("base64");
  } catch (e: any) {
    console.error("[offers] PDF prepare failed", e);
    return NextResponse.json({ error: "Could not prepare the offer PDF." }, { status: 500 });
  }

  const who = offer.customer_name || offer.customer_company || "Sir";
  const subject = `Offer ${offer.offer_number} — Route Survey (LBI)`;
  const intro = typeof body.message === "string" && body.message.trim() ? body.message.trim() : "";
  const html =
    `<p>Dear ${escapeHtml(who)},</p>` +
    (intro ? `<p>${escapeHtml(intro)}</p>` : "") +
    `<p>Please find attached our offer <b>${escapeHtml(offer.offer_number)}</b> for the proposed route survey.</p>` +
    `<p>We look forward to your response.</p>`;
  const text = `Dear ${who},\n\n${intro ? intro + "\n\n" : ""}Please find attached our offer ${offer.offer_number} for the proposed route survey.\n\nWe look forward to your response.`;

  try {
    await sendEmail({
      to,
      subject,
      html,
      text,
      fromEmail: sender.email,
      fromName: sender.name,
      attachments: [
        {
          filename: `${String(offer.offer_number).replace(/[^\w.-]+/g, "_")}.pdf`,
          content: pdfBase64,
          contentType: "application/pdf",
        },
      ],
    });
  } catch (e: any) {
    console.error("[offers] send failed", e);
    return NextResponse.json({ error: e?.message || "Failed to send the offer email." }, { status: 502 });
  }

  // Mark the offer sent.
  await db.execute("UPDATE offers SET status = 'sent', sent_at = NOW() WHERE id = ? AND user_id = ?", [
    params.id,
    session.id,
  ]);

  // Auto-generate the Proforma Invoice (skip if this offer already has one).
  let invoiceNumber = await existingInvoiceNumber(session.id, offer.offer_number);
  let invoiceCreated = false;
  if (!invoiceNumber) {
    try {
      const created = await createProformaInvoice(session.id, session.email, offerToInvoiceInput(offer, routes));
      invoiceNumber = created.invoice_number;
      invoiceCreated = true;
    } catch (e: any) {
      // The offer was sent successfully; surface the PI failure without failing the send.
      console.error("[offers] auto PI failed", e);
      return NextResponse.json({ ok: true, to, invoice_number: null, invoiceError: "Offer sent, but the proforma invoice could not be generated." });
    }
  }

  return NextResponse.json({ ok: true, to, invoice_number: invoiceNumber, invoiceCreated });
}

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
