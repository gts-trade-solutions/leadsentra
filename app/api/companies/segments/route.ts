import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET  /api/companies/segments         -> list { segments: string[] }
 * POST /api/companies/segments  body { name } -> creates a new segment (INSERT IGNORE)
 *
 * The segment list powers a dropdown on the Companies page filter + Add Company form.
 * Any logged-in user can add a new segment.
 */
export async function GET() {
  const session = await getUser();
  if (!session) return NextResponse.json({ segments: [] }, { status: 401 });

  const [rows] = await db.execute(
    "SELECT name FROM company_segments ORDER BY name ASC"
  );
  const segments = (rows as any[]).map((r) => r.name as string);
  return NextResponse.json({ segments });
}

export async function POST(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const name = String(body?.name || "").trim();
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  if (name.length > 64) {
    return NextResponse.json({ error: "name too long (max 64 chars)" }, { status: 400 });
  }

  await db.execute(
    "INSERT IGNORE INTO company_segments (name, created_by) VALUES (?, ?)",
    [name, session.id]
  );

  return NextResponse.json({ ok: true, name }, { status: 201 });
}
