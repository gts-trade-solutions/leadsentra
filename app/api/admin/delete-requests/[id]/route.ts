import { NextResponse } from "next/server";
import { requireRole } from "@/lib/admin";
import { decideDeleteRequest } from "@/lib/deleteRequests";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/admin/delete-requests/:id   body: { action: "approve" | "reject", note? }
 *
 * Super admin only — that is the whole point of the role. Approving CARRIES OUT
 * the deletion; the response says what it actually did.
 *
 * A deletion that can no longer run (the row is gone, a company grew contacts
 * while the request waited) comes back 409 and the request is recorded as
 * `failed`, never as approved — the queue must not claim something was removed
 * when it wasn't.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const gate = await requireRole("super_admin");
  if (!("user" in gate)) return gate.response;

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "action must be approve or reject" }, { status: 400 });
  }
  const note = body.note ? String(body.note).slice(0, 512) : null;

  const result = await decideDeleteRequest(params.id, gate.user.id, action === "approve", note);
  if (!result.ok) {
    // "already decided" / "not found" is a 409; a deletion that ran and failed
    // is also a 409 — either way nothing more will happen to this request.
    return NextResponse.json(
      { error: result.error, status: result.status },
      { status: result.error === "Request not found" ? 404 : 409 }
    );
  }

  return NextResponse.json({ ok: true, status: result.status, outcome: result.outcome ?? null });
}
