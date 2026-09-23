import { NextResponse } from "next/server";
import { gateDelete, pendingDeleteResponse } from "@/lib/deleteRequests";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { loadInvoiceWithItems } from "@/lib/invoiceRepo";
import { recordInvoiceBillTo } from "@/lib/billToRepo";
import { rememberBankDetails, resolveSellerProfile } from "@/lib/companyProfilesRepo";
import {
  normalizeItems,
  computeTotals,
  num,
  parseRecipients,
  MAX_INVOICE_RECIPIENTS,
} from "@/lib/invoices";


export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Trim to a string or null, capped so an oversized field can't blow the column. */
function s(v: unknown, max = 255): string | null {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t ? t.slice(0, max) : null;
}

// ---- GET: a single invoice with items ----
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const found = await loadInvoiceWithItems(session.id, params.id);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // The edit form opens read-only for an invoice already confirmed as an
  // order, rather than letting someone edit and only then refusing the save.
  const [orderRows] = await db.execute(
    "SELECT order_number FROM orders WHERE user_id = ? AND invoice_id = ? LIMIT 1",
    [session.id, params.id]
  );
  const lockedByOrder = ((orderRows as any[])[0]?.order_number as string | undefined) ?? null;

  return NextResponse.json({ invoice: found.invoice, items: found.items, locked_by_order: lockedByOrder });
}

/**
 * ---- PATCH: edit an invoice ----
 *
 * A proforma is a quotation, not a tax document, so correcting a typo or a
 * price shouldn't mean deleting it and re-keying everything under a new
 * number. Only the fields sent are changed. Everything the form shows is
 * editable — customer, your company block, bank, terms, declaration,
 * signatory, currency, the invoice number, and which company it is issued as
 * (which brings that company's logo, signature and seal). The created/sent
 * history is not.
 *
 * Refused once the invoice has been confirmed into an order: at that point the
 * order holds a snapshot of these values, and editing behind it would leave the
 * two disagreeing about what was agreed.
 *
 * When `items` is supplied it replaces the line items wholesale and the totals
 * are recomputed server-side — the client never gets to state its own totals.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const found = await loadInvoiceWithItems(session.id, params.id);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [orderRows] = await db.execute(
    "SELECT order_number FROM orders WHERE user_id = ? AND invoice_id = ? LIMIT 1",
    [session.id, params.id]
  );
  const order = (orderRows as any[])[0];
  if (order) {
    return NextResponse.json(
      {
        error: `This invoice was confirmed as order ${order.order_number} and can no longer be edited.`,
      },
      { status: 409 }
    );
  }

  const body = await req.json().catch(() => ({}));

  // Plain column updates — only what the caller actually sent.
  const map: Record<string, { col: string; max?: number }> = {
    subject:            { col: "subject", max: 512 },
    customer_name:      { col: "customer_name" },
    customer_email:     { col: "customer_email" },
    customer_phone:     { col: "customer_phone", max: 64 },
    customer_company:   { col: "customer_company" },
    customer_gstin:     { col: "customer_gstin", max: 32 },
    customer_pan:       { col: "customer_pan", max: 32 },
    customer_address:   { col: "customer_address", max: 2000 },
    ref:                { col: "ref" },
    payment_terms:      { col: "payment_terms", max: 512 },
    delivery_terms:     { col: "delivery_terms" },
    notes:              { col: "notes", max: 2000 },
    terms:              { col: "terms", max: 2000 },
    // Your company block, as printed on this invoice.
    seller_name:        { col: "seller_name" },
    seller_email:       { col: "seller_email" },
    seller_phone:       { col: "seller_phone", max: 64 },
    seller_company:     { col: "seller_company" },
    seller_gstin:       { col: "seller_gstin", max: 32 },
    seller_pan:         { col: "seller_pan", max: 32 },
    seller_address:     { col: "seller_address", max: 2000 },
    bank_name:          { col: "bank_name" },
    bank_account:       { col: "bank_account", max: 64 },
    bank_branch:        { col: "bank_branch" },
    bank_ifsc:          { col: "bank_ifsc", max: 32 },
    declaration:        { col: "declaration", max: 2000 },
    signatory_name:     { col: "signatory_name" },
  };

  const sets: string[] = [];
  const vals: any[] = [];
  for (const [key, { col, max }] of Object.entries(map)) {
    if (key in body) {
      sets.push(`${col} = ?`);
      vals.push(s(body[key], max ?? 255));
    }
  }

  // The extra people this invoice is emailed to — normalised, de-duplicated,
  // and never a repeat of the customer of record.
  if ("extra_recipients" in body) {
    const parsed = parseRecipients(body.extra_recipients);
    if (parsed.invalid.length) {
      return NextResponse.json(
        { error: `Not a valid email address: ${parsed.invalid.join(", ")}` },
        { status: 400 }
      );
    }
    const primary = String(
      ("customer_email" in body ? body.customer_email : found.invoice.customer_email) || ""
    )
      .trim()
      .toLowerCase();
    sets.push("extra_recipients = ?");
    vals.push(
      parsed.valid
        .filter((e) => e !== primary)
        .slice(0, MAX_INVOICE_RECIPIENTS - 1)
        .join(", ") || null
    );
  }

  // A blank number keeps the current one — an invoice can't be left unnumbered.
  const newNumber = s(body.invoice_number, 64);
  if (newNumber && newNumber !== found.invoice.invoice_number) {
    sets.push("invoice_number = ?");
    vals.push(newNumber);
  }

  const currency = s(body.currency, 8);
  if (currency) {
    sets.push("currency = ?");
    vals.push(currency.toUpperCase());
  }

  // Which of your companies it is issued as. Its logo, signature and seal are
  // re-taken from that company, so the saved invoice prints exactly what the
  // preview showed. A typed company not saved yet is saved, as on create.
  let profileId: string | null = null;
  if ("company_profile_id" in body || "seller_company" in body) {
    const { profile } = await resolveSellerProfile(session.id, body, { create: true });
    if (profile) {
      profileId = profile.id;
      sets.push("logo_path = ?", "signature_path = ?", "seal_path = ?");
      vals.push(profile.logo_path || null, profile.signature_path || null, profile.seal_path || null);
    }
  }

  if ("issue_date" in body && /^\d{4}-\d{2}-\d{2}$/.test(String(body.issue_date || ""))) {
    sets.push("issue_date = ?");
    vals.push(String(body.issue_date));
  }
  if ("valid_until" in body) {
    const v = String(body.valid_until || "");
    sets.push("valid_until = ?");
    vals.push(/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  }

  // Line items + money. Totals are always derived, never taken from the client.
  let items: ReturnType<typeof normalizeItems> | null = null;
  if (Array.isArray(body.items)) {
    items = normalizeItems(body.items);
    if (!items.length) {
      return NextResponse.json({ error: "At least one line item is required." }, { status: 400 });
    }
  }
  const discount = "discount" in body ? Math.max(0, num(body.discount, 0)) : found.invoice.discount;
  const taxRate  = "tax_rate" in body ? Math.max(0, num(body.tax_rate, 0)) : found.invoice.tax_rate;
  const igstRate = "igst_rate" in body ? Math.max(0, num(body.igst_rate, 0)) : num(found.invoice.igst_rate, 0);

  const moneyChanged =
    items !== null || "discount" in body || "tax_rate" in body || "igst_rate" in body;
  if (moneyChanged) {
    const totals = computeTotals(items ?? found.items, discount, taxRate, igstRate);
    sets.push(
      "subtotal = ?", "discount = ?", "tax_rate = ?", "tax_amount = ?",
      "igst_rate = ?", "igst_amount = ?", "total = ?"
    );
    vals.push(
      totals.subtotal, discount, taxRate, totals.tax_amount,
      igstRate, totals.igst_amount, totals.total
    );
  }

  if (!sets.length && !items) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    if (sets.length) {
      await conn.execute(
        `UPDATE proforma_invoices SET ${sets.join(", ")}, updated_at = NOW()
          WHERE id = ? AND user_id = ?`,
        [...vals, params.id, session.id]
      );
    }

    if (items) {
      await conn.execute("DELETE FROM proforma_invoice_items WHERE invoice_id = ?", [params.id]);
      // Same shape as the create path: `id` is generated by the table, and the
      // optional columns are coerced to NULL rather than passed as undefined.
      for (const it of items) {
        await conn.execute(
          `INSERT INTO proforma_invoice_items
             (invoice_id, position, part_no, description, hsn, quantity, unit_price, amount)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [params.id, it.position, it.part_no ?? null, it.description, it.hsn ?? null, it.quantity, it.unit_price, it.amount]
        );
      }
    }

    await conn.commit();
  } catch (e: any) {
    await conn.rollback();
    if (e?.code === "ER_DUP_ENTRY") {
      return NextResponse.json(
        { error: `Invoice number ${newNumber} is already used by another of your invoices.` },
        { status: 409 }
      );
    }
    console.error("[invoices] update failed", e);
    return NextResponse.json({ error: e?.message || "Update failed" }, { status: 500 });
  } finally {
    conn.release();
  }

  // Same follow-ups as creating one, once the edit is committed: the customer
  // is kept in the address book, and the bank block as the company's default
  // when asked. Neither can fail the save.
  if (["customer_name", "customer_email", "customer_company"].some((k) => k in body)) {
    await recordInvoiceBillTo(session.id, s(body.bill_to_id, 36), {
      contact_id: s(body.customer_contact_id, 36),
      company_id: s(body.customer_company_id, 36),
      name: s(body.customer_name),
      email: s(body.customer_email),
      phone: s(body.customer_phone, 64),
      company: s(body.customer_company),
      gstin: s(body.customer_gstin, 32),
      pan: s(body.customer_pan, 32),
      address: s(body.customer_address, 2000),
    });
  }
  if (body.save_bank_default) {
    await rememberBankDetails(session.id, profileId, {
      name: s(body.bank_name),
      account: s(body.bank_account, 64),
      branch: s(body.bank_branch),
      ifsc: s(body.bank_ifsc, 32),
    });
  }

  const fresh = await loadInvoiceWithItems(session.id, params.id);
  return NextResponse.json({ invoice: fresh?.invoice, items: fresh?.items });
}

// ---- DELETE: remove an invoice (items cascade) ----
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [own] = await db.execute(
    "SELECT id, invoice_number FROM proforma_invoices WHERE id = ? AND user_id = ? LIMIT 1",
    [params.id, session.id]
  );
  const invoice = (own as any[])[0];
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const gate = await gateDelete(session, {
    resource: "invoice",
    id: params.id,
    label: invoice.invoice_number || params.id,
  });
  if (!gate.allowed) return pendingDeleteResponse(gate);

  const [res] = await db.execute(
    "DELETE FROM proforma_invoices WHERE id = ? AND user_id = ?",
    [params.id, session.id]
  );
  const affected = (res as any)?.affectedRows || 0;
  if (!affected) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
