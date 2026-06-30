import type { Metadata } from "next";
import OfferTemplates from "./Templates";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Offer Templates" };

export default function Page() {
  return <OfferTemplates />;
}
