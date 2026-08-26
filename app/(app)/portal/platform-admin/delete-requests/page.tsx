import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { isStaff } from "@/lib/roles";
import DeleteRequests from "./DeleteRequests";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Delete Requests" };

/**
 * Open to all staff, not just the super admin: an admin needs to see what they
 * asked for and whether it was approved. The API decides what each of them can
 * see (own requests vs everyone's) and who is allowed to act.
 */
export default async function Page() {
  const session = await getUser();
  if (!session) redirect("/auth/signin?next=/portal/platform-admin/delete-requests");
  if (!isStaff(session.role)) redirect("/portal");
  return <DeleteRequests />;
}
