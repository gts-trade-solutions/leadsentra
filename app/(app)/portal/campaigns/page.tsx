import type { Metadata } from "next";
import CampaignsPage from "./Campaign";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Campaigns" };

export default function Page() {
  return <CampaignsPage />;
}
