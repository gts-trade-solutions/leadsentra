import type { Metadata } from "next";
import InvoiceSettings from "./InvoiceSettings";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Invoice Settings" };

export default function Page() {
  return <InvoiceSettings />;
}
