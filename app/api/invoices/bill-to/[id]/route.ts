import { NextResponse } from "next/server";
import { getUser, HttpError } from "@/lib/auth";
import { getBillTo, updateBillTo, deleteBillTo } from "@/lib/billToRepo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ---- GET: one saved address ----
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const address = await getBillTo(session.id, params.id);
  if (!address) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ address });
}

// ---- PATCH: edit a saved address ----
// Only the fields sent are changed; the required-field check runs on the
// merged row so correcting one field on an auto-captured address doesn't fail
// on the parts that were never filled in.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  try {
    const address = await updateBillTo(session.id, params.id, body);
    return NextResponse.json({ address });
  } catch (e: any) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[bill-to] update failed", e);
    return NextResponse.json({ error: "Could not update the address. Please try again." }, { status: 500 });
  }
}

// ---- DELETE: drop a saved address ----
// Invoices keep their own snapshot of the customer, so nothing already issued
// changes when an address is removed from the book.
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const removed = await deleteBillTo(session.id, params.id);
  if (!removed) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
