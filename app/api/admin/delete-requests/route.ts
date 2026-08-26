import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { isStaff, isSuperAdmin } from "@/lib/admin";
import {
  listDeleteRequests,
  countPendingDeleteRequests,
  type DeleteRequestStatus,
} from "@/lib/deleteRequests";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/admin/delete-requests?status=pending
 *
 * A super admin sees every request — this is their queue. An admin sees only
 * the ones they raised, so they can tell whether what they asked for was
 * approved, rejected, or failed when it ran.
 */
export async function GET(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isStaff(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const asked = url.searchParams.get("status") || "pending";
  const status = (["pending", "approved", "rejected", "failed", "all"].includes(asked)
    ? asked
    : "pending") as DeleteRequestStatus | "all";

  const superAdmin = isSuperAdmin(session.role);
  const data = await listDeleteRequests({
    status,
    requestedBy: superAdmin ? undefined : session.id,
  });
  // Only the person who can act on them needs the badge count.
  const pending = superAdmin ? await countPendingDeleteRequests() : 0;

  return NextResponse.json({ data, pending, can_decide: superAdmin });
}
