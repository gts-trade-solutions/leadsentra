import { randomUUID } from "crypto";
import { db } from "./db";
import { HttpError } from "./auth";
import { normalizeItems, computeTotals, nextInvoiceNumber, num } from "./invoices";

/**
 * Shared "create a proforma invoice" routine used by both the invoices API
 * (manual builder) and the offer -> PI action. Snapshots the seller's billing
 * profile + invoice settings onto the invoice, allocates the next number inside
 * a transaction, and inserts the invoice + line items.
 *
 * Throws HttpError(400) on validation problems so callers can map the status.
 */

function s(v: unknown, max = 255): string | null {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t ? t.slice(0, max) : null;
}

async function loadBillingProfile(userId: string) {
  const [rows] = await db.execute(
    "SELECT full_name, email, phone, company, gstin, address FROM billing_profiles WHERE user_id = ? LIMIT 1",
    [userId]
  );
  return (rows as any[])[0] || null;
}

async function loadInvoiceSettings(userId: string) {
  const [rows] = await db.execute("SELECT * FROM invoice_settings WHERE user_id = ? LIMIT 1", [userId]);
  return (rows as any[])[0] || null;
}

export type CreateInvoiceResult = { id: string; invoice_number: string };

export async function createProformaInvoice(
  userId: string,
  userEmail: string | null,
  body: any
): Promise<CreateInvoiceResult> {
  const items = normalizeItems(body.items);
  if (!items.length) {
    throw new HttpError(400, "Add at least one line item with a description.");
  }

  const customer = {
    contact_id: s(body.customer_contact_id, 36),
    company_id: s(body.customer_company_id, 36),
    name: s(body.customer_name),
    email: s(body.customer_email),
    company: s(body.customer_company),
    gstin: s(body.customer_gstin, 32),
    address: s(body.customer_address, 2000),
  };
  if (!customer.name && !customer.company) {
    throw new HttpError(400, "Customer name or company is required.");
  }

  const [profile, settings] = await Promise.all([
    loadBillingProfile(userId),
    loadInvoiceSettings(userId),
  ]);

  const seller = {
    name: s(body.seller_name) ?? (profile?.full_name || userEmail || null),
    email: s(body.seller_email) ?? (settings?.email || profile?.email || userEmail || null),
    phone: s(body.seller_phone, 64) ?? (settings?.phone || profile?.phone || null),
    company: s(body.seller_company) ?? (settings?.seller_company || profile?.company || null),
    gstin: s(body.seller_gstin, 32) ?? (settings?.gstin || profile?.gstin || null),
    pan: s(body.seller_pan, 32) ?? (settings?.pan || null),
    address: s(body.seller_address, 2000) ?? (settings?.seller_address || profile?.address || null),
  };

  const ref = s(body.ref, 255);
  const paymentTerms = s(body.payment_terms, 512) ?? (settings?.payment_terms || null);
  const deliveryTerms = s(body.delivery_terms, 255) ?? (settings?.delivery_terms || null);
  const bank = {
    name: s(body.bank_name) ?? (settings?.bank_name || null),
    account: s(body.bank_account, 64) ?? (settings?.bank_account || null),
    branch: s(body.bank_branch) ?? (settings?.bank_branch || null),
    ifsc: s(body.bank_ifsc, 32) ?? (settings?.bank_ifsc || null),
  };
  const declaration = s(body.declaration, 2000) ?? (settings?.declaration || null);
  const signatoryName = s(body.signatory_name) ?? (settings?.signatory_name || null);
  const logoPath = settings?.logo_path || null;
  const signaturePath = settings?.signature_path || null;

  const discount = Math.max(0, num(body.discount, 0));
  const taxRate = Math.max(0, num(body.tax_rate, 0));
  const totals = computeTotals(items, discount, taxRate);

  const issueDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.issue_date || ""))
    ? String(body.issue_date)
    : new Date().toISOString().slice(0, 10);
  const validUntil = /^\d{4}-\d{2}-\d{2}$/.test(String(body.valid_until || ""))
    ? String(body.valid_until)
    : null;

  const currency = (s(body.currency, 8) || "INR").toUpperCase();
  const notes = s(body.notes, 4000);
  const terms = s(body.terms, 4000);

  const id = randomUUID();
  const year = Number(issueDate.slice(0, 4)) || new Date().getFullYear();

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const invoiceNumber = await nextInvoiceNumber(conn, userId, year, settings?.invoice_prefix);

    await conn.execute(
      `INSERT INTO proforma_invoices
        (id, user_id, invoice_number, status, source,
         customer_contact_id, customer_company_id, customer_name, customer_email,
         customer_company, customer_gstin, customer_address,
         seller_name, seller_email, seller_phone, seller_company, seller_gstin, seller_pan, seller_address,
         ref, payment_terms, delivery_terms,
         bank_name, bank_account, bank_branch, bank_ifsc,
         declaration, signatory_name, logo_path, signature_path,
         issue_date, valid_until, currency, subtotal, discount, tax_rate, tax_amount, total,
         notes, terms)
       VALUES (?, ?, ?, 'draft', 'generated',
         ?, ?, ?, ?,
         ?, ?, ?,
         ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?,
         ?, ?, ?, ?,
         ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?, ?, ?,
         ?, ?)`,
      [
        id, userId, invoiceNumber,
        customer.contact_id, customer.company_id, customer.name, customer.email,
        customer.company, customer.gstin, customer.address,
        seller.name, seller.email, seller.phone, seller.company, seller.gstin, seller.pan, seller.address,
        ref, paymentTerms, deliveryTerms,
        bank.name, bank.account, bank.branch, bank.ifsc,
        declaration, signatoryName, logoPath, signaturePath,
        issueDate, validUntil, currency, totals.subtotal, totals.discount, totals.tax_rate, totals.tax_amount, totals.total,
        notes, terms,
      ]
    );

    for (const it of items) {
      await conn.execute(
        `INSERT INTO proforma_invoice_items
           (invoice_id, position, part_no, description, hsn, quantity, unit_price, amount)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, it.position, it.part_no ?? null, it.description, it.hsn ?? null, it.quantity, it.unit_price, it.amount]
      );
    }

    await conn.commit();
    return { id, invoice_number: invoiceNumber };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}
