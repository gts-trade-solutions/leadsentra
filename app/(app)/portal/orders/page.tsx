import type { Metadata } from "next";
import OrdersPage from "./Orders";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Orders" };

export default function Page() {
  return <OrdersPage />;
}
