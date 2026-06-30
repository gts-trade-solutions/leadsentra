import type { Metadata } from "next";
import InvoicesPage from "./Invoices";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Proforma Invoices" };

export default function Page() {
  return <InvoicesPage />;
}
