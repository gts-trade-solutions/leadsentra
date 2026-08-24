import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { isEmailShape } from "@/lib/suppressions";
import { parseRecipients, MAX_INVOICE_RECIPIENTS } from "@/lib/invoices";
import { loadInvoiceWithItems, toPdfData, loadInvoiceAssets } from "@/lib/invoiceRepo";
import { generateInvoicePdf } from "@/lib/invoicePdf";
import { buildInvoiceEmail } from "@/lib/invoiceEmail";
import { sendEmail } from "@/lib/emailProvider";
import { readPublicFile } from "@/lib/invoiceUpload";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ResolvedSender = {
  email: string;
  name?: string;
  /** False when we had to fall back to a different address than the invoice's. */
  matchesInvoice: boolean;
};

/**
 * Resolve the From address for an invoice email.
 *
 * This used to take the account's DEFAULT verified sender and ignore the
 * invoice entirely — so an invoice whose seller address is
 * enquiry@raceinnovations.in arrived from marketing@raceautoindia.com while
 * the subject line still read "…from enquiry@raceinnovations.in". The envelope
 * and the contents disagreed, which looks like spoofing to a recipient.
 *
 * Order of preference:
 *   1. The invoice's own seller_email, when it's a verified sender.
 *   2. The account default (SES rejects unverified From addresses, so we can't
 *      simply use seller_email regardless) — and then Reply-To is pointed at
 *      the seller address so replies still land in the right inbox.
 *   3. Env fallbacks.
 */
async function resolveSender(
  userId: string,
  sellerEmail: string | null
): Promise<ResolvedSender | null> {
  const wanted = String(sellerEmail || "").trim().toLowerCase();

  if (wanted) {
    const [own] = await db.execute(
      `SELECT email, display_name
         FROM email_identities
        WHERE user_id = ? AND status = 'verified' AND LOWER(email) = ?
        LIMIT 1`,
      [userId, wanted]
    );
    const hit = (own as any[])[0];
    if (hit?.email) {
      return { email: hit.email, name: hit.display_name || undefined, matchesInvoice: true };
    }
  }

  const [rows] = await db.execute(
    `SELECT email, display_name, is_default
       FROM email_identities
      WHERE user_id = ? AND status = 'verified'
      ORDER BY is_default DESC, updated_at DESC
      LIMIT 1`,
    [userId]
  );
  const row = (rows as any[])[0];
  if (row?.email) {
    return {
      email: row.email,
      name: row.display_name || undefined,
      matchesInvoice: !wanted || row.email.toLowerCase() === wanted,
    };
  }

  const envFrom = process.env.DEFAULT_FROM_EMAIL || process.env.EMAIL_FROM;
  if (envFrom) {
    // EMAIL_FROM may be "Name <addr@x>"; pull the bare address out for the SES path.
    const m = envFrom.match(/<([^>]+)>/);
    const email = (m ? m[1] : envFrom).trim();
    const name = m ? envFrom.replace(/<[^>]+>/, "").trim().replace(/(^"|"$)/g, "") : undefined;
    if (isEmailShape(email)) {
      return { email, name: name || undefined, matchesInvoice: email.toLowerCase() === wanted };
    }
  }
  return null;
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const found = await loadInvoiceWithItems(session.id, params.id);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));

  // Recipients: an explicit override, else the invoice's own list — the
  // customer of record first, then everyone it was saved to reach (billing,
  // procurement, whoever asked for it). Accepts an array or a
  // comma/semicolon-separated string.
  const explicit = body.to !== undefined && body.to !== null && body.to !== "";
  const parsed = parseRecipients(
    explicit ? body.to : [found.invoice.customer_email, found.invoice.extra_recipients]
  );

  if (parsed.invalid.length) {
    return NextResponse.json(
      { error: `Not a valid email address: ${parsed.invalid.join(", ")}` },
      { status: 400 }
    );
  }
  const recipients = parsed.valid;
  if (!recipients.length) {
    return NextResponse.json(
      { error: "A valid customer email is required to send the invoice." },
      { status: 400 }
    );
  }
  if (recipients.length > MAX_INVOICE_RECIPIENTS) {
    return NextResponse.json(
      { error: `Too many recipients (max ${MAX_INVOICE_RECIPIENTS}).` },
      { status: 400 }
    );
  }
  // The first address is the invoice's customer of record; the rest ride along.
  const to = recipients[0];

  const sender = await resolveSender(session.id, found.invoice.seller_email);
  if (!sender) {
    return NextResponse.json(
      {
        error:
          "No verified sender address. Verify a sender under Email settings, or set DEFAULT_FROM_EMAIL.",
      },
      { status: 400 }
    );
  }

  // Persist the recipients if they changed / were missing, so a re-send from
  // the list goes to the same people this send did.
  const extras = recipients.slice(1).join(", ") || null;
  if (
    to !== (found.invoice.customer_email || "").toLowerCase() ||
    extras !== (found.invoice.extra_recipients || null)
  ) {
    await db.execute(
      "UPDATE proforma_invoices SET customer_email = ?, extra_recipients = ? WHERE id = ? AND user_id = ?",
      [to, extras, params.id, session.id]
    );
    found.invoice.customer_email = to;
    found.invoice.extra_recipients = extras;
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
      to: recipients,
      subject,
      html,
      text,
      fromEmail: sender.email,
      // Prefer the seller's own display name over the identity's, so the
      // recipient sees the company that issued the invoice.
      fromName: found.invoice.seller_company || sender.name,
      // When the From had to differ from the invoice's seller address, point
      // replies back at that address rather than at whatever we sent from.
      replyTo: sender.matchesInvoice
        ? undefined
        : found.invoice.seller_email || undefined,
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

    return NextResponse.json({
      ok: true,
      to,
      recipients,
      messageId: res.id,
      /** What it was actually sent from — surfaced so a mismatch is visible. */
      from: sender.email,
      /** True when that is the invoice's own seller address. */
      from_matches_invoice: sender.matchesInvoice,
    });
  } catch (e: any) {
    console.error("[invoices] send failed", e);
    return NextResponse.json(
      { error: e?.message || "Failed to send the invoice email." },
      { status: 502 }
    );
  }
}
