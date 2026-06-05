import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET  /api/email/identities
 *   Returns ALL of the caller's sender identities (verified + pending),
 *   default first, then most-recently-updated.  Powers the "Send from"
 *   dropdown + the Manage drawer.
 *
 * PATCH /api/email/identities   { id, action: "default" }
 *   Marks one identity as the user's default sender (clears the flag on the
 *   others).  Only a verified identity may become the default.
 */
export async function GET() {
  const session = await getUser();
  if (!session) return NextResponse.json({ identities: [] }, { status: 401 });

  const [rows] = await db.execute(
    `SELECT id, email, display_name, status, is_default, verified_at, changes_used
       FROM email_identities
      WHERE user_id = ?
      ORDER BY is_default DESC, updated_at DESC`,
    [session.id]
  );
  return NextResponse.json({ identities: rows });
}

export async function PATCH(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const id = body?.id ? String(body.id) : null;
  const action = String(body?.action || "default");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  if (action !== "default") {
    return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  }

  // Ownership + verification check.  Only a verified identity can be default —
  // otherwise the dropdown could select a sender SES will reject at send time.
  const [rows] = await db.execute(
    "SELECT id, status FROM email_identities WHERE id = ? AND user_id = ? LIMIT 1",
    [id, session.id]
  );
  const row = (rows as any[])[0];
  if (!row) return NextResponse.json({ error: "Identity not found" }, { status: 404 });
  if (row.status !== "verified") {
    return NextResponse.json(
      { error: "Only a verified sender can be set as default." },
      { status: 409 }
    );
  }

  // Flip the default atomically: clear all, then set this one.
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      "UPDATE email_identities SET is_default = 0, updated_at = NOW() WHERE user_id = ?",
      [session.id]
    );
    await conn.execute(
      "UPDATE email_identities SET is_default = 1, updated_at = NOW() WHERE id = ? AND user_id = ?",
      [id, session.id]
    );
    await conn.commit();
  } catch (e: any) {
    await conn.rollback();
    return NextResponse.json({ error: e?.message || "Update failed" }, { status: 500 });
  } finally {
    conn.release();
  }

  return NextResponse.json({ ok: true, id });
}
