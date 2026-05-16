import type { Metadata } from "next";
import Tracking from "./Tracking";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Email Tracking" };

export default function Page() {
  return <Tracking />;
}
