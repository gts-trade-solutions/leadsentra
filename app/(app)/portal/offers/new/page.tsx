import type { Metadata } from "next";
import NewOffer from "./NewOffer";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New LBI Offer" };

export default function Page() {
  return <NewOffer />;
}
