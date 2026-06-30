import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { updateOrder, deleteOrder } from "@/lib/orders";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// PATCH: update status / PO number / notes.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const ok = await updateOrder(session.id, params.id, {
    status: body.status,
    po_number: body.po_number,
    notes: body.notes,
  });
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

// DELETE: remove an order.
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ok = await deleteOrder(session.id, params.id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
