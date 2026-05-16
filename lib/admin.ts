import { NextResponse } from "next/server";
import { getUser, type SessionUser } from "@/lib/auth";

export type StaffRole = "admin" | "moderator";

export function isAdmin(role?: string | null): boolean {
  return role === "admin";
}
export function isStaff(role?: string | null): boolean {
  return role === "admin" || role === "moderator";
}

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
  roles: "admin" | "staff"
): Promise<{ user: SessionUser } | { response: NextResponse }> {
  const session = await getUser();
  if (!session) {
    return { response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const ok = roles === "admin" ? isAdmin(session.role) : isStaff(session.role);
  if (!ok) {
    return { response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user: session };
}
