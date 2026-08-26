import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { gateDelete, pendingDeleteResponse } from "@/lib/deleteRequests";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { cleanPhone, cleanUrl, type CleanResult, type UrlPlatform } from "@/lib/validate";

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

  const existing = await fetchOwned(params.id, session.id, isAdmin(session.role));
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.user_id && existing.user_id !== session.id && !isAdmin(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));

  // All editable fields are direct SQL columns now (migration 2026-05-11
  // promoted department/location/notes/facebook_url/instagram_url out of
  // the meta JSON). Single map keeps the code simple and consistent with
  // POST + bulk import.
  const map: Record<string, string> = {
    contact_name: "contact_name",
    email: "email",
    title: "title",
    phone: "phone",
    linkedin_url: "linkedin_url",
    company_id: "company_id",
    department: "department",
    location: "location",
    notes: "notes",
    facebook_url: "facebook_url",
    instagram_url: "instagram_url",
  };
  // Phone / social URL fields go through the shared cleaner: placeholder
  // junk ("not provided", "n/a", …) saves as NULL, malformed values 400.
  const cleaners: Record<string, (v: any) => CleanResult> = {
    phone: (v) => cleanPhone(v),
    linkedin_url: (v) => cleanUrl(v, "linkedin" as UrlPlatform, "LinkedIn URL"),
    facebook_url: (v) => cleanUrl(v, "facebook" as UrlPlatform, "Facebook URL"),
    instagram_url: (v) => cleanUrl(v, "instagram" as UrlPlatform, "Instagram URL"),
  };

  const sets: string[] = [];
  const vals: any[] = [];
  for (const [key, col] of Object.entries(map)) {
    if (key in body) {
      const v = typeof body[key] === "string" ? body[key].trim() : body[key];
      if (cleaners[key]) {
        const cleaned = cleaners[key](v);
        if (cleaned.error) {
          return NextResponse.json({ error: cleaned.error }, { status: 400 });
        }
        sets.push(`${col} = ?`);
        vals.push(cleaned.value);
        continue;
      }
      sets.push(`${col} = ?`);
      vals.push(v === "" ? null : v);
    }
  }

  // contact_type is NOT NULL and constrained to a fixed set, so it's handled
  // separately from the generic map (which would allow NULL). Only 'lead' or
  // 'normal' are accepted; anything else is ignored.
  if ("contact_type" in body) {
    const t = String(body.contact_type || "").toLowerCase();
    if (t === "lead" || t === "normal") {
      sets.push("contact_type = ?");
      vals.push(t);
    }
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

  const existing = await fetchOwned(params.id, session.id, isAdmin(session.role));
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.user_id && existing.user_id !== session.id && !isAdmin(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Staff below super admin ask instead of deleting. A user deleting their own
  // contact is unaffected.
  const gate = await gateDelete(session, {
    resource: "contact",
    id: params.id,
    label: existing.contact_name || existing.email || params.id,
  });
  if (!gate.allowed) return pendingDeleteResponse(gate);

  // Clean up unlock / campaign-recipient rows that reference this contact
  await db.execute("DELETE FROM unlocked_contacts WHERE contact_id = ?", [params.id]);
  await db.execute("DELETE FROM contacts_unlocks WHERE contact_id = ?", [params.id]);
  await db.execute("DELETE FROM contacts WHERE id = ?", [params.id]);

  return NextResponse.json({ ok: true });
}
