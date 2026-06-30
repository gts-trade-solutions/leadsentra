import type { Metadata } from "next";
import NewInvoice from "./NewInvoice";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New Proforma Invoice" };

export default function Page() {
  return <NewInvoice />;
}
