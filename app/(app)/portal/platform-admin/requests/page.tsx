import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { isAdmin } from "@/lib/roles";
import CompanyRequests from "./Requests";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Company Join Requests" };

export default async function Page() {
  const session = await getUser();
  if (!session) redirect("/auth/signin?next=/portal/platform-admin/requests");
  if (!isAdmin(session.role)) redirect("/portal");
  return <CompanyRequests />;
}
