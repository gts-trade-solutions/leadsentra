import type { Metadata } from "next";
import InboxPage from "./Inbox";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Inbox" };

export default function Page() {
  return <InboxPage />;
}
