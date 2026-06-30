import { NextResponse } from "next/server";
import { getUser, HttpError } from "@/lib/auth";
import { createOrderFromInvoice } from "@/lib/orders";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/invoices/:id/order
 * Mark a proforma invoice as an order confirmation — snapshots it into the
 * Orders tab. Body (optional): { po_number, notes }. Deduped per invoice.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  try {
    const r = await createOrderFromInvoice(session.id, params.id, {
      po_number: body.po_number ?? null,
      notes: body.notes ?? null,
    });
    return NextResponse.json(r, { status: r.existed ? 200 : 201 });
  } catch (e: any) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[invoices] confirm order failed", e);
    return NextResponse.json({ error: "Could not create the order." }, { status: 500 });
  }
}
