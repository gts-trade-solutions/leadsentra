import type { Metadata } from "next";
import OffersPage from "./Offers";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "LBI Offers" };

export default function Page() {
  return <OffersPage />;
}
