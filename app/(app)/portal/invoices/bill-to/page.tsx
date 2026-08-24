import type { Metadata } from "next";
import BillToAddresses from "./BillToAddresses";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Saved Bill-To Addresses" };

export default function Page() {
  return <BillToAddresses />;
}
