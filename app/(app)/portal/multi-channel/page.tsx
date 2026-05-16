import type { Metadata } from "next";
import MultiChannelPage from "./Multichannel";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Multi-Channel" };

export default function Page() {
  return <MultiChannelPage />;
}
