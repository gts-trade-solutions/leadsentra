import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function fetchOwned(id: string, userId: string, isAdmin: boolean) {
  const sql = isAdmin
    ? "SELECT * FROM companies WHERE company_id = ? LIMIT 1"
    : "SELECT * FROM companies WHERE company_id = ? AND (user_id = ? OR user_id IS NULL) LIMIT 1";
  const params = isAdmin ? [id] : [id, userId];
  const [rows] = await db.execute(sql, params);
  return (rows as any[])[0] || null;
}

export async function PATCH(req: Request, { params }: { params: { company_id: string } }) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const existing = await fetchOwned(params.company_id, session.id, session.role === "admin");
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.user_id && existing.user_id !== session.id && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const sets: string[] = [];
  const vals: any[] = [];

  const map: Record<string, string> = {
    name: "company_name",
    type: "industry",
    segment: "segment",
    size: "size",
    website: "website",
    linkedin: "linkedin",
    country: "country",
    // City/regency lives on its own direct column; the UI calls it "Region".
    region: "city_regency",
    city_regency: "city_regency",
    // Main contact phone for the company.
    phone: "phone_main",
    phone_main: "phone_main",
  };

  for (const [key, col] of Object.entries(map)) {
    if (key in body) {
      const v = typeof body[key] === "string" ? body[key].trim() : body[key];
      sets.push(`${col} = ?`);
      vals.push(v === "" ? null : v);
    }
  }

  if (!sets.length) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  vals.push(params.company_id);
  await db.execute(`UPDATE companies SET ${sets.join(", ")} WHERE company_id = ?`, vals);

  const [rows] = await db.execute(
    "SELECT * FROM companies WHERE company_id = ? LIMIT 1",
    [params.company_id]
  );
  return NextResponse.json({ company: (rows as any[])[0] });
}

export async function DELETE(_req: Request, { params }: { params: { company_id: string } }) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const existing = await fetchOwned(params.company_id, session.id, session.role === "admin");
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.user_id && existing.user_id !== session.id && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [cnt] = await db.execute(
    "SELECT COUNT(*) AS c FROM contacts WHERE company_id = ?",
    [params.company_id]
  );
  const c = Number((cnt as any[])[0]?.c || 0);
  if (c > 0) {
    return NextResponse.json(
      { error: `Cannot delete: ${c} contact(s) still reference this company` },
      { status: 409 }
    );
  }

  await db.execute("DELETE FROM companies WHERE company_id = ?", [params.company_id]);
  return NextResponse.json({ ok: true });
}
