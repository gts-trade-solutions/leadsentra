import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { requireRole, isAdmin, isStaff } from "@/lib/admin";
import { gateDelete, pendingDeleteResponse, deleteUserAccount } from "@/lib/deleteRequests";
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
  if (!isAdmin(caller.role) && isStaff(target.role)) {
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
    if ((role === "admin" || role === "moderator") && !isAdmin(caller.role)) {
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

  const [rows] = await db.execute("SELECT id, role, email FROM users WHERE id = ? LIMIT 1", [params.id]);
  const target = (rows as any[])[0];
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // An admin can no longer remove someone outright: the account and every
  // company, contact and campaign under it goes with them, which is the most
  // destructive thing in the app. A super admin still does it directly.
  const deleteGate = await gateDelete(caller, {
    resource: "user",
    id: params.id,
    label: target.email || params.id,
  });
  if (!deleteGate.allowed) return pendingDeleteResponse(deleteGate);

  // The cascade itself lives in lib/deleteRequests.ts, so approving a request
  // runs exactly this and the two can never drift apart. The last-admin and
  // last-super-admin guards are in there too.
  const result = await deleteUserAccount(params.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true });
}
