import { NextResponse } from "next/server";
import { requireRole } from "@/lib/admin";
import { listRequests, countPendingRequests, type MembershipStatus } from "@/lib/memberships";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/admin/company-requests?status=pending  (admin only)
export async function GET(req: Request) {
  const gate = await requireRole("admin");
  if (!("user" in gate)) return gate.response;

  const url = new URL(req.url);
  const status = (url.searchParams.get("status") || "pending") as MembershipStatus | "all";
  const valid = ["pending", "approved", "rejected", "all"].includes(status) ? status : "pending";

  const [data, pending] = await Promise.all([listRequests(valid), countPendingRequests()]);
  return NextResponse.json({ data, pending });
}
