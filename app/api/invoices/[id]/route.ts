import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { loadInvoiceWithItems } from "@/lib/invoiceRepo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ---- GET: a single invoice with items ----
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const found = await loadInvoiceWithItems(session.id, params.id);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ invoice: found.invoice, items: found.items });
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
