import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { listUserMemberships, requestMembership } from "@/lib/memberships";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET: this user's company memberships (any status).
export async function GET() {
  const session = await getUser();
  if (!session) return NextResponse.json({ data: [] }, { status: 401 });
  const data = await listUserMemberships(session.id);
  return NextResponse.json({ data });
}

// POST: request to join a company. Body: { company_id }.
export async function POST(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const companyId = String(body.company_id || "").trim();
  if (!companyId) return NextResponse.json({ error: "Pick a company to request." }, { status: 400 });

  const r = await requestMembership(session.id, companyId);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ status: r.status }, { status: 201 });
}
