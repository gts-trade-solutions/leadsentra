import type { Metadata } from "next";
import CompanyAccess from "./CompanyAccess";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Company Access" };

export default function Page() {
  return <CompanyAccess />;
}
