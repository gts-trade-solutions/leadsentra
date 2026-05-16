import type { Metadata } from "next";
import { Suspense } from "react";
import VerifyOtpForm from "./VerifyOtpForm";

export const metadata: Metadata = { title: "Verify email" };
export const dynamic = "force-dynamic";

export default function VerifyPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-950" />}>
      <VerifyOtpForm />
    </Suspense>
  );
}
