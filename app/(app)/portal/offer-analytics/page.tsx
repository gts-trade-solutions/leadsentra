import type { Metadata } from "next";
import OfferAnalytics from "./OfferAnalytics";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Offer Analytics" };

export default function Page() {
  return <OfferAnalytics />;
}
