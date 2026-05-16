import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/admin";
import { validatePassword } from "@/lib/password";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * PATCH /api/admin/users/[id]
 * Body fields (any subset):
 *   role:          'user' | 'moderator' | 'admin'   (admin-only for 'admin')
 *   email_verified: 0 | 1
 *   password:      new password (validated)
 *   full_name:     string
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const gate = await requireRole("staff");
  if ("response" in gate) return gate.response;
  const caller = gate.user;

  const [rows] = await db.execute(
    "SELECT id, role FROM users WHERE id = ? LIMIT 1",
    [params.id]
  );
  const target = (rows as any[])[0];
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Moderators can edit users; only admins can edit other admins/moderators.
  if (caller.role !== "admin" && (target.role === "admin" || target.role === "moderator")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const sets: string[] = [];
  const vals: any[] = [];

  if (body.role !== undefined) {
    const role = String(body.role).toLowerCase();
    if (!["user", "moderator", "admin"].includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }
    // Only admins can mint OR promote anyone to a staff role.  Without this
    // a moderator could PATCH a regular user to `role=moderator` and silently
    // expand the staff pool (each new moderator gets free credits + global
    // visibility, so this is a privilege expansion).
    if ((role === "admin" || role === "moderator") && caller.role !== "admin") {
      return NextResponse.json(
        { error: "Only admins can assign staff roles (admin / moderator)" },
        { status: 403 }
      );
    }
    sets.push("role = ?");
    vals.push(role);
  }
  if (body.email_verified !== undefined) {
    sets.push("email_verified = ?");
    vals.push(body.email_verified ? 1 : 0);
  }
  if (body.full_name !== undefined) {
    sets.push("full_name = ?");
    vals.push(String(body.full_name).trim() || null);
  }
  if (body.password !== undefined) {
    const pw = String(body.password);
    const pwErr = validatePassword(pw);
    if (pwErr) return NextResponse.json({ error: pwErr }, { status: 400 });
    const hash = await bcrypt.hash(pw, 10);
    sets.push("password_hash = ?");
    vals.push(hash);
  }

  if (!sets.length) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }
  vals.push(params.id);
  await db.execute(
    `UPDATE users SET ${sets.join(", ")}, updated_at = NOW() WHERE id = ?`,
    vals
  );

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/admin/users/[id]
 * Admin-only.  Cascade-cleans wallets/ledger/suppressions so we don't leak rows.
 */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const gate = await requireRole("admin");
  if ("response" in gate) return gate.response;
  const caller = gate.user;

  if (params.id === caller.id) {
    return NextResponse.json({ error: "You cannot delete your own account here" }, { status: 400 });
  }

  const [rows] = await db.execute("SELECT id, role FROM users WHERE id = ? LIMIT 1", [params.id]);
  const target = (rows as any[])[0];
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Refuse to delete the last remaining admin
  if (target.role === "admin") {
    const [[adminCount]] = await db.query(
      "SELECT COUNT(*) AS n FROM users WHERE role = 'admin'"
    ) as any;
    if (Number(adminCount?.n || 0) <= 1) {
      return NextResponse.json(
        { error: "Cannot delete the last remaining admin" },
        { status: 400 }
      );
    }
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute("DELETE FROM credits_ledger WHERE user_id = ?", [params.id]);
    await conn.execute("DELETE FROM credits_wallets WHERE user_id = ?", [params.id]);
    await conn.execute("DELETE FROM wallet WHERE user_id = ?", [params.id]);
    await conn.execute("DELETE FROM suppressions WHERE user_id = ?", [params.id]);
    await conn.execute("DELETE FROM unlocked_contacts WHERE user_id = ?", [params.id]);
    await conn.execute("DELETE FROM contacts_unlocks WHERE user_id = ?", [params.id]);
    await conn.execute("DELETE FROM company_assets_unlocks WHERE user_id = ?", [params.id]);
    await conn.execute("DELETE FROM email_identities WHERE user_id = ?", [params.id]);
    await conn.execute("DELETE FROM email_verification_tokens WHERE user_id = ?", [params.id]);
    await conn.execute("DELETE FROM password_reset_tokens WHERE user_id = ?", [params.id]);
    // Campaigns + their recipients
    await conn.execute(
      "DELETE FROM campaign_recipients WHERE user_id = ? OR campaign_id IN (SELECT id FROM campaigns WHERE user_id = ?)",
      [params.id, params.id]
    );
    await conn.execute("DELETE FROM campaigns WHERE user_id = ?", [params.id]);

    // Companies this user uploaded.  Contacts under those companies first —
    // they may have an FK or just a soft reference; we delete them so we
    // don't end up with orphaned contacts pointing to a vanished company_id.
    const [contactRows] = await conn.execute(
      "SELECT id FROM contacts WHERE company_id IN (SELECT company_id FROM companies WHERE user_id = ?)",
      [params.id]
    );
    const contactIds = (contactRows as any[]).map((r) => r.id);
    if (contactIds.length) {
      const ph = contactIds.map(() => "?").join(",");
      await conn.execute(
        `DELETE FROM unlocked_contacts WHERE contact_id IN (${ph})`,
        contactIds
      );
      await conn.execute(
        `DELETE FROM contacts_unlocks WHERE contact_id IN (${ph})`,
        contactIds
      );
      await conn.execute(`DELETE FROM contacts WHERE id IN (${ph})`, contactIds);
    }
    await conn.execute("DELETE FROM companies WHERE user_id = ?", [params.id]);

    // Pending OTPs / signup attempts under this email.
    await conn.execute(
      "DELETE FROM pending_registrations WHERE email = (SELECT email FROM users WHERE id = ?)",
      [params.id]
    );

    await conn.execute("DELETE FROM users WHERE id = ?", [params.id]);
    await conn.commit();
  } catch (e: any) {
    await conn.rollback();
    return NextResponse.json({ error: e?.message || "Delete failed" }, { status: 500 });
  } finally {
    conn.release();
  }

  return NextResponse.json({ ok: true });
}
