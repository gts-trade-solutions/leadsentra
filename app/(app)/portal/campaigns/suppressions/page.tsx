import type { Metadata } from "next";
import Suppressions from "./Suppressions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Suppressions" };

export default function Page() {
  return <Suppressions />;
}
