import type { Metadata } from "next";
import SignInPage from "./Signin";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in" };

export default function Page() {
  return <SignInPage />;
}
