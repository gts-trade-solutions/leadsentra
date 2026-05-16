import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import PlatformAdmin from "./PlatformAdmin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Platform Admin" };

/**
 * Server-side admin gate.  Without this, a non-admin user (or moderator)
 * hitting the URL directly briefly sees the page chrome before the client
 * useAuth() check fires.  Now we render NOTHING server-side unless the
 * session is admin — moderators and regular users get bounced before the
 * HTML is even sent.
 */
export default async function Page() {
  const session = await getUser();
  if (!session) {
    redirect("/auth/signin?next=/portal/platform-admin");
  }
  if (session.role !== "admin") {
    // Moderators already have credit-bypass globally — no panel needed.
    // Regular users have no business here either.
    redirect("/portal");
  }
  return <PlatformAdmin />;
}
