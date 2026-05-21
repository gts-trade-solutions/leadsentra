import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function fetchOwned(id: string, userId: string, isAdmin: boolean) {
  const sql = isAdmin
    ? "SELECT * FROM contacts WHERE id = ? LIMIT 1"
    : "SELECT * FROM contacts WHERE id = ? AND (user_id = ? OR user_id IS NULL) LIMIT 1";
  const params = isAdmin ? [id] : [id, userId];
  const [rows] = await db.execute(sql, params);
  return (rows as any[])[0] || null;
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const existing = await fetchOwned(params.id, session.id, session.role === "admin");
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.user_id && existing.user_id !== session.id && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));

  // Direct column updates (proper SQL columns).
  const map: Record<string, string> = {
    contact_name: "contact_name",
    email: "email",
    title: "title",
    phone: "phone",
    linkedin_url: "linkedin_url",
    company_id: "company_id",
  };
  const sets: string[] = [];
  const vals: any[] = [];
  for (const [key, col] of Object.entries(map)) {
    if (key in body) {
      const v = typeof body[key] === "string" ? body[key].trim() : body[key];
      sets.push(`${col} = ?`);
      vals.push(v === "" ? null : v);
    }
  }

  // Meta JSON updates — these five fields are stored inside the meta JSON
  // column rather than as proper columns. Use JSON_SET to patch only the
  // keys the caller sent, preserving any other keys already in meta.
  // COALESCE(meta, JSON_OBJECT()) handles rows where meta is NULL.
  const metaKeys = ["department", "location", "notes", "facebook_url", "instagram_url"] as const;
  const metaPairs: string[] = [];
  const metaVals: any[] = [];
  for (const key of metaKeys) {
    if (key in body) {
      const v = typeof body[key] === "string" ? body[key].trim() : body[key];
      metaPairs.push(`'$.${key}', ?`);
      metaVals.push(v === "" ? null : v);
    }
  }
  if (metaPairs.length) {
    sets.push(`meta = JSON_SET(COALESCE(meta, JSON_OBJECT()), ${metaPairs.join(", ")})`);
    vals.push(...metaVals);
  }

  if (!sets.length) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  vals.push(params.id);
  await db.execute(`UPDATE contacts SET ${sets.join(", ")} WHERE id = ?`, vals);

  const [rows] = await db.execute("SELECT * FROM contacts WHERE id = ? LIMIT 1", [params.id]);
  return NextResponse.json({ contact: (rows as any[])[0] });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const existing = await fetchOwned(params.id, session.id, session.role === "admin");
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.user_id && existing.user_id !== session.id && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Clean up unlock / campaign-recipient rows that reference this contact
  await db.execute("DELETE FROM unlocked_contacts WHERE contact_id = ?", [params.id]);
  await db.execute("DELETE FROM contacts_unlocks WHERE contact_id = ?", [params.id]);
  await db.execute("DELETE FROM contacts WHERE id = ?", [params.id]);

  return NextResponse.json({ ok: true });
}
