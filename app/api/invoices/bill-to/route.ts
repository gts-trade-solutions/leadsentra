import { NextResponse } from "next/server";
import { getUser, HttpError } from "@/lib/auth";
import { listBillTo, createBillTo } from "@/lib/billToRepo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ---- GET: this user's saved bill-to addresses ----
// The whole book is returned (capped) and filtered in the browser: it is a few
// hundred rows at most, and the picker has to stay responsive while typing.
export async function GET(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ data: [] }, { status: 401 });

  const limit = Number(new URL(req.url).searchParams.get("limit") || 500);
  const data = await listBillTo(session.id, limit);
  return NextResponse.json({ data });
}

// ---- POST: save a new address (Quick Add / Manage) ----
export async function POST(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  try {
    const address = await createBillTo(session.id, body);
    return NextResponse.json({ address }, { status: 201 });
  } catch (e: any) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[bill-to] create failed", e);
    return NextResponse.json({ error: "Could not save the address. Please try again." }, { status: 500 });
  }
}
