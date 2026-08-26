/**
 * Role predicates, and nothing else.
 *
 * Split out of lib/admin.ts so client components can ask "is this user an
 * admin?" without dragging next/server and the session lookup into the browser
 * bundle. lib/admin.ts re-exports these, so server code can keep importing from
 * there and there is still only one definition of what each role means.
 *
 * Ranked: super_admin > admin > moderator > user.
 */

export type Role = "super_admin" | "admin" | "moderator" | "user";

/** The top role: the only one that can delete shared data without asking, and
 *  the only one that can approve the delete requests admins raise. */
export function isSuperAdmin(role?: string | null): boolean {
  return role === "super_admin";
}

/** True for admin AND super_admin — a super admin has every admin power. */
export function isAdmin(role?: string | null): boolean {
  return role === "admin" || isSuperAdmin(role);
}

/** Admins (either kind) plus moderators. */
export function isStaff(role?: string | null): boolean {
  return isAdmin(role) || role === "moderator";
}

/** For display: "Super admin", "Admin", "Moderator", "User". */
export function roleLabel(role?: string | null): string {
  switch (role) {
    case "super_admin":
      return "Super admin";
    case "admin":
      return "Admin";
    case "moderator":
      return "Moderator";
    default:
      return "User";
  }
}
