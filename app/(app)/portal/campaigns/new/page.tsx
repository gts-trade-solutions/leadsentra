import type { Metadata } from "next";
import NewCampaign from "./NewCampaign";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New Campaign" };

export default function Page() {
  return <NewCampaign />;
}
