import type { Metadata } from "next";
import SignUpPage from "./SignUp";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign up" };

export default function Page() {
  return <SignUpPage />;
}
