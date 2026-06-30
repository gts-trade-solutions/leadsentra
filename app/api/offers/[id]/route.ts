import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { loadOfferWithRoutes } from "@/lib/offerRepo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ---- GET: a single offer with its routes ----
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const found = await loadOfferWithRoutes(session.id, params.id);
  if (!found) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ offer: found.offer, routes: found.routes });
}

// ---- DELETE: remove an offer (routes cascade) ----
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [res] = await db.execute(
    "DELETE FROM offers WHERE id = ? AND user_id = ?",
    [params.id, session.id]
  );
  const affected = (res as any)?.affectedRows || 0;
  if (!affected) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
