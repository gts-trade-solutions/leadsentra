import type { Metadata } from "next";
import CataloguesPage from "./Catalogues";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Catalogues & Offers" };

export default function Page() {
  return <CataloguesPage />;
}
