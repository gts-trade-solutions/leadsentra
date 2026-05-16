import type { Metadata } from "next";
import TrackingPage from "./Tracking";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Campaign tracking" };

export default function Page({ params }: { params: { campaignId: string } }) {
  return <TrackingPage campaignId={params.campaignId} />;
}
