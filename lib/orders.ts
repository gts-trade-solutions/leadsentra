import { randomUUID } from "crypto";
import { db } from "./db";
import { HttpError } from "./auth";
import { num } from "./invoices";
import { loadInvoiceWithItems } from "./invoiceRepo";

/**
 * Orders (order confirmations) created by marking a proforma invoice as
 * confirmed. The order snapshots the invoice's customer + amount so later edits
 * to the invoice don't rewrite confirmed-order history.
 */

export const ORDER_STATUSES = ["confirmed", "in_progress", "delivered", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export type OrderRecord = {
  id: string;
  order_number: string;
  invoice_id: string | null;
  invoice_number: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_company: string | null;
  currency: string;
  total: number;
  status: string;
  po_number: string | null;
  notes: string | null;
  confirmed_at: string;
  created_at: string;
};

/** Allocate the next ORD-YYYY-#### number for this user+year (row-locked). */
async function nextOrderNumber(conn: any, userId: string, year: number): Promise<string> {
  await conn.execute(
    `INSERT INTO order_seq (user_id, yr, last_seq) VALUES (?, ?, 0)
     ON DUPLICATE KEY UPDATE user_id = user_id`,
    [userId, year]
  );
  const [rows] = await conn.execute(
    "SELECT last_seq FROM order_seq WHERE user_id = ? AND yr = ? FOR UPDATE",
    [userId, year]
  );
  const next = Number((rows as any[])[0]?.last_seq || 0) + 1;
  await conn.execute("UPDATE order_seq SET last_seq = ? WHERE user_id = ? AND yr = ?", [next, userId, year]);
  return `ORD-${year}-${String(next).padStart(4, "0")}`;
}

/**
 * Create an order by confirming a proforma invoice. Idempotent: if an order
 * already exists for that invoice, returns it instead of creating a duplicate.
 * Throws HttpError(404) if the invoice isn't found for this user.
 */
export async function createOrderFromInvoice(
  userId: string,
  invoiceId: string,
  opts: { po_number?: string | null; notes?: string | null } = {}
): Promise<{ id: string; order_number: string; existed: boolean }> {
  const found = await loadInvoiceWithItems(userId, invoiceId);
  if (!found) throw new HttpError(404, "Invoice not found.");
  const inv = found.invoice;

  // Already confirmed? Return the existing order.
  const [existingRows] = await db.execute(
    "SELECT id, order_number FROM orders WHERE user_id = ? AND invoice_id = ? LIMIT 1",
    [userId, invoiceId]
  );
  const existing = (existingRows as any[])[0];
  if (existing) return { id: existing.id, order_number: existing.order_number, existed: true };

  const id = randomUUID();
  const year = Number((inv.issue_date || "").slice(0, 4)) || new Date().getFullYear();
  const poNumber = opts.po_number ? String(opts.po_number).trim().slice(0, 128) || null : null;
  const notes = opts.notes ? String(opts.notes).slice(0, 4000) : null;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const orderNumber = await nextOrderNumber(conn, userId, year);
    await conn.execute(
      `INSERT INTO orders
         (id, user_id, order_number, invoice_id, invoice_number,
          customer_name, customer_email, customer_company, customer_address,
          currency, total, status, po_number, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?)`,
      [
        id, userId, orderNumber, inv.id, inv.invoice_number,
        inv.customer_name, inv.customer_email, inv.customer_company, inv.customer_address,
        inv.currency, inv.total, poNumber, notes,
      ]
    );
    await conn.commit();
    return { id, order_number: orderNumber, existed: false };
  } catch (e: any) {
    await conn.rollback();
    // A racing confirm could trip the unique key — return the now-existing one.
    if (e?.code === "ER_DUP_ENTRY") {
      const [rows] = await db.execute(
        "SELECT id, order_number FROM orders WHERE user_id = ? AND invoice_id = ? LIMIT 1",
        [userId, invoiceId]
      );
      const row = (rows as any[])[0];
      if (row) return { id: row.id, order_number: row.order_number, existed: true };
    }
    throw e;
  } finally {
    conn.release();
  }
}

/** List a user's orders. */
export async function listOrders(userId: string, status?: string): Promise<OrderRecord[]> {
  const where = ["user_id = ?"];
  const params: any[] = [userId];
  if (status && (ORDER_STATUSES as readonly string[]).includes(status)) {
    where.push("status = ?");
    params.push(status);
  }
  const [rows] = await db.execute(
    `SELECT id, order_number, invoice_id, invoice_number, customer_name, customer_email,
            customer_company, currency, total, status, po_number, notes, confirmed_at, created_at
       FROM orders WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT 1000`,
    params
  );
  return (rows as any[]).map((r) => ({
    id: r.id,
    order_number: r.order_number,
    invoice_id: r.invoice_id,
    invoice_number: r.invoice_number,
    customer_name: r.customer_name,
    customer_email: r.customer_email,
    customer_company: r.customer_company,
    currency: r.currency || "INR",
    total: num(r.total),
    status: r.status,
    po_number: r.po_number,
    notes: r.notes,
    confirmed_at: String(r.confirmed_at),
    created_at: String(r.created_at),
  }));
}

/** Update an order's status / PO number / notes. */
export async function updateOrder(
  userId: string,
  id: string,
  patch: { status?: string; po_number?: string | null; notes?: string | null }
): Promise<boolean> {
  const sets: string[] = [];
  const params: any[] = [];
  if (patch.status !== undefined && (ORDER_STATUSES as readonly string[]).includes(patch.status)) {
    sets.push("status = ?");
    params.push(patch.status);
  }
  if (patch.po_number !== undefined) {
    sets.push("po_number = ?");
    params.push(patch.po_number ? String(patch.po_number).slice(0, 128) : null);
  }
  if (patch.notes !== undefined) {
    sets.push("notes = ?");
    params.push(patch.notes ? String(patch.notes).slice(0, 4000) : null);
  }
  if (!sets.length) return true;
  params.push(id, userId);
  const [res] = await db.execute(`UPDATE orders SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`, params);
  return ((res as any)?.affectedRows || 0) > 0;
}

export async function deleteOrder(userId: string, id: string): Promise<boolean> {
  const [res] = await db.execute("DELETE FROM orders WHERE id = ? AND user_id = ?", [id, userId]);
  return ((res as any)?.affectedRows || 0) > 0;
}
