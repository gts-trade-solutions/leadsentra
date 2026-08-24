import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { nextInvoiceNumber, num, parseRecipients, MAX_INVOICE_RECIPIENTS } from "@/lib/invoices";
import { saveInvoiceFile } from "@/lib/invoiceUpload";
import { recordInvoiceBillTo } from "@/lib/billToRepo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function f(form: FormData, key: string, max = 255): string | null {
  const v = form.get(key);
  if (v === null || v === undefined || v instanceof File) return null;
  const t = String(v).trim();
  return t ? t.slice(0, max) : null;
}

/**
 * POST /api/invoices/upload  (multipart/form-data)
 *
 * Creates an invoice from a user-supplied PDF (source='upload'). No line items
 * or generated PDF — the uploaded file is stored and later attached on send.
 */
export async function POST(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Expected form data" }, { status: 400 });

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Attach a PDF file." }, { status: 400 });
  }
  const saved = await saveInvoiceFile(file, { allow: ["application/pdf"], maxBytes: 25 * 1024 * 1024 });
  if ("error" in saved) return NextResponse.json({ error: saved.error }, { status: 400 });

  const customerName = f(form, "customer_name");
  const customerCompany = f(form, "customer_company");
  if (!customerName && !customerCompany) {
    return NextResponse.json({ error: "Customer name or company is required." }, { status: 400 });
  }

  // Everyone besides the customer of record who should get this invoice.
  const customerEmail = f(form, "customer_email");
  const extra = parseRecipients(f(form, "extra_recipients", 1024));
  if (extra.invalid.length) {
    return NextResponse.json(
      { error: `Not a valid email address: ${extra.invalid.join(", ")}` },
      { status: 400 }
    );
  }
  const extraRecipients =
    extra.valid
      .filter((e) => e !== String(customerEmail || "").trim().toLowerCase())
      .slice(0, MAX_INVOICE_RECIPIENTS - 1)
      .join(", ") || null;

  const currency = (f(form, "currency", 8) || "INR").toUpperCase();
  const total = Math.max(0, num(form.get("total"), 0));
  const issueDate = /^\d{4}-\d{2}-\d{2}$/.test(String(form.get("issue_date") || ""))
    ? String(form.get("issue_date"))
    : new Date().toISOString().slice(0, 10);

  const [settingsRows] = await db.execute(
    "SELECT seller_company, seller_address, gstin, pan, email, phone, invoice_prefix FROM invoice_settings WHERE user_id = ? LIMIT 1",
    [session.id]
  );
  const settings = (settingsRows as any[])[0] || null;

  const id = randomUUID();
  const year = Number(issueDate.slice(0, 4)) || new Date().getFullYear();

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const invoiceNumber = await nextInvoiceNumber(conn, session.id, year, settings?.invoice_prefix);

    await conn.execute(
      `INSERT INTO proforma_invoices
        (id, user_id, invoice_number, status, source, pdf_path,
         customer_contact_id, customer_company_id, customer_name, customer_email, extra_recipients,
         customer_phone, customer_company, customer_gstin, customer_pan, customer_address,
         seller_name, seller_email, seller_phone, seller_company, seller_gstin, seller_pan, seller_address,
         issue_date, currency, subtotal, discount, tax_rate, tax_amount, total, notes)
       VALUES (?, ?, ?, 'draft', 'upload', ?,
         ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?, 0, 0, 0, ?, ?)`,
      [
        id, session.id, invoiceNumber, saved.file_path,
        f(form, "customer_contact_id", 36), f(form, "customer_company_id", 36), customerName, customerEmail, extraRecipients,
        f(form, "customer_phone", 64), customerCompany, f(form, "customer_gstin", 32), f(form, "customer_pan", 32), f(form, "customer_address", 2000),
        null, settings?.email || session.email || null, settings?.phone || null,
        settings?.seller_company || null, settings?.gstin || null, settings?.pan || null, settings?.seller_address || null,
        issueDate, currency, total, total, f(form, "notes", 4000),
      ]
    );

    await conn.commit();

    // Same as the generated path: the customer this PDF was billed to goes
    // into the address book (or the address it was picked from is marked as
    // used), after the invoice itself is safe.
    await recordInvoiceBillTo(session.id, f(form, "bill_to_id", 36), {
      name: customerName,
      company: customerCompany,
      email: customerEmail,
      phone: f(form, "customer_phone", 64),
      gstin: f(form, "customer_gstin", 32),
      pan: f(form, "customer_pan", 32),
      address: f(form, "customer_address", 2000),
      contact_id: f(form, "customer_contact_id", 36),
      company_id: f(form, "customer_company_id", 36),
    });

    return NextResponse.json({ id, invoice_number: invoiceNumber }, { status: 201 });
  } catch (e: any) {
    await conn.rollback();
    console.error("[invoices] upload create failed", e);
    return NextResponse.json({ error: "Could not save the uploaded invoice." }, { status: 500 });
  } finally {
    conn.release();
  }
}
