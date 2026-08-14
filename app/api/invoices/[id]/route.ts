import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { loadInvoiceWithItems } from "@/lib/invoiceRepo";
import { normalizeItems, computeTotals, num } from "@/lib/invoices";


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

  return NextResponse.json({ invoice: found.invoice, items: found.items });
}

/**
 * ---- PATCH: edit an invoice ----
 *
 * A proforma is a quotation, not a tax document, so correcting a typo or a
 * price shouldn't mean deleting it and re-keying everything under a new
 * number. Only the fields sent are changed; the invoice number and the
 * created/sent history are not editable here.
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
  };

  const sets: string[] = [];
  const vals: any[] = [];
  for (const [key, { col, max }] of Object.entries(map)) {
    if (key in body) {
      sets.push(`${col} = ?`);
      vals.push(s(body[key], max ?? 255));
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
    console.error("[invoices] update failed", e);
    return NextResponse.json({ error: e?.message || "Update failed" }, { status: 500 });
  } finally {
    conn.release();
  }

  const fresh = await loadInvoiceWithItems(session.id, params.id);
  return NextResponse.json({ invoice: fresh?.invoice, items: fresh?.items });
}

// ---- DELETE: remove an invoice (items cascade) ----
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [res] = await db.execute(
    "DELETE FROM proforma_invoices WHERE id = ? AND user_id = ?",
    [params.id, session.id]
  );
  const affected = (res as any)?.affectedRows || 0;
  if (!affected) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
