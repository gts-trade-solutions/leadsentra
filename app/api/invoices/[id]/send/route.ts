import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { isEmailShape } from "@/lib/suppressions";
import { loadInvoiceWithItems, toPdfData, loadInvoiceAssets } from "@/lib/invoiceRepo";
import { generateInvoicePdf } from "@/lib/invoicePdf";
import { buildInvoiceEmail } from "@/lib/invoiceEmail";
import { sendEmail } from "@/lib/emailProvider";
import { readPublicFile } from "@/lib/invoiceUpload";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Resolve the From address: prefer a verified sender identity (default
 *  first), then env fallbacks. */
async function resolveSender(userId: string): Promise<{ email: string; name?: string } | null> {
  const [rows] = await db.execute(
    `SELECT email, display_name, is_default
       FROM email_identities
      WHERE user_id = ? AND status = 'verified'
      ORDER BY is_default DESC, updated_at DESC
      LIMIT 1`,
    [userId]
  );
  const row = (rows as any[])[0];
  if (row?.email) return { email: row.email, name: row.display_name || undefined };

  const envFrom = process.env.DEFAULT_FROM_EMAIL || process.env.EMAIL_FROM;
  if (envFrom) {
    // EMAIL_FROM may be "Name <addr@x>"; pull the bare address out for the SES path.
    const m = envFrom.match(/<([^>]+)>/);
    const email = (m ? m[1] : envFrom).trim();
    const name = m ? envFrom.replace(/<[^>]+>/, "").trim().replace(/(^"|"$)/g, "") : undefined;
    if (isEmailShape(email)) return { email, name: name || undefined };
  }
  return null;
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const found = await loadInvoiceWithItems(session.id, params.id);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));

  // Recipient: explicit override, else the invoice's saved customer email.
  const to = String(body.to || found.invoice.customer_email || "").trim().toLowerCase();
  if (!isEmailShape(to)) {
    return NextResponse.json(
      { error: "A valid customer email is required to send the invoice." },
      { status: 400 }
    );
  }

  const sender = await resolveSender(session.id);
  if (!sender) {
    return NextResponse.json(
      {
        error:
          "No verified sender address. Verify a sender under Email settings, or set DEFAULT_FROM_EMAIL.",
      },
      { status: 400 }
    );
  }

  // Persist the recipient if it changed / was missing, so re-sends and the PDF
  // stay consistent with what we actually sent to.
  if (to !== (found.invoice.customer_email || "").toLowerCase()) {
    await db.execute("UPDATE proforma_invoices SET customer_email = ? WHERE id = ? AND user_id = ?", [
      to,
      params.id,
      session.id,
    ]);
    found.invoice.customer_email = to;
  }

  // Get the PDF bytes: the uploaded file for 'upload' invoices, else generate.
  let pdfBase64: string;
  try {
    let bytes: Uint8Array;
    if (found.invoice.source === "upload" && found.invoice.pdf_path) {
      const buf = await readPublicFile(found.invoice.pdf_path);
      if (!buf) throw new Error("Uploaded PDF file is missing.");
      bytes = new Uint8Array(buf);
    } else {
      const assets = await loadInvoiceAssets(found.invoice);
      bytes = await generateInvoicePdf(toPdfData(found.invoice, found.items), assets);
    }
    pdfBase64 = Buffer.from(bytes).toString("base64");
  } catch (e: any) {
    console.error("[invoices] PDF prepare failed", e);
    return NextResponse.json({ error: "Could not prepare the invoice PDF." }, { status: 500 });
  }

  const { subject, html, text } = buildInvoiceEmail(found.invoice, found.items, {
    message: typeof body.message === "string" ? body.message : undefined,
  });

  try {
    const res = await sendEmail({
      to,
      subject,
      html,
      text,
      fromEmail: sender.email,
      fromName: sender.name,
      attachments: [
        {
          filename: `${found.invoice.invoice_number}.pdf`,
          content: pdfBase64,
          contentType: "application/pdf",
        },
      ],
    });

    await db.execute(
      "UPDATE proforma_invoices SET status = 'sent', sent_at = NOW() WHERE id = ? AND user_id = ?",
      [params.id, session.id]
    );

    return NextResponse.json({ ok: true, to, messageId: res.id });
  } catch (e: any) {
    console.error("[invoices] send failed", e);
    return NextResponse.json(
      { error: e?.message || "Failed to send the invoice email." },
      { status: 502 }
    );
  }
}
