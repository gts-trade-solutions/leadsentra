import type { Metadata } from "next";
import CompaniesPage from "./Companies";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Companies" };

export default function Page() {
  return <CompaniesPage />;
}
