import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await getUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [counts] = await db.execute(
    "SELECT company_id, contact_count FROM company_contact_counts"
  );
  const [unmapped] = await db.execute("SELECT * FROM unmapped_contacts");

  return NextResponse.json({
    companies: counts,
    unmapped_contacts: unmapped,
  });
}
