import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { listOrders } from "@/lib/orders";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/orders?status=confirmed -> this user's orders.
export async function GET(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ data: [] }, { status: 401 });
  const url = new URL(req.url);
  const status = url.searchParams.get("status") || undefined;
  const data = await listOrders(session.id, status);
  return NextResponse.json({ data });
}
