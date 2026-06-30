import { NextResponse } from "next/server";
import { requireRole } from "@/lib/admin";
import { decideRequest } from "@/lib/memberships";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/admin/company-requests/:id  body: { action: "approve" | "reject", note? }
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const gate = await requireRole("admin");
  if (!("user" in gate)) return gate.response;

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "action must be approve or reject" }, { status: 400 });
  }
  const note = body.note ? String(body.note).slice(0, 512) : null;

  const ok = await decideRequest(params.id, gate.user.id, action === "approve", note);
  if (!ok) return NextResponse.json({ error: "Request not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
