import { NextResponse } from "next/server";
import { getUser, type SessionUser } from "@/lib/auth";
import { isSuperAdmin, isAdmin, isStaff } from "@/lib/roles";

export type StaffRole = "super_admin" | "admin" | "moderator";

/**
 * Roles rank: super_admin > admin > moderator > user.
 *
 * A super admin IS an admin — isAdmin() is true for both, so every existing
 * admin-gated screen and route works for them unchanged. The only thing the
 * top role adds is the power to delete shared business data outright, and to
 * approve the delete requests that admins now have to raise instead
 * (see lib/deleteRequests.ts).
 *
 * The predicates live in lib/roles.ts so client components can use them too;
 * they are re-exported here so existing server imports keep working.
 */
export { isSuperAdmin, isAdmin, isStaff };

/**
 * Returns the session if the caller has the requested role(s), or returns
 * a NextResponse JSON error that the route handler can return directly.
 *
 * Usage:
 *   const gate = await requireRole("admin");
 *   if (!("user" in gate)) return gate.response;
 *   const user = gate.user;
 */
export async function requireRole(
  roles: "super_admin" | "admin" | "staff"
): Promise<{ user: SessionUser } | { response: NextResponse }> {
  const session = await getUser();
  if (!session) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const ok =
    roles === "super_admin"
      ? isSuperAdmin(session.role)
      : roles === "admin"
      ? isAdmin(session.role)
      : isStaff(session.role);
  if (!ok) {
    return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user: session };
}
