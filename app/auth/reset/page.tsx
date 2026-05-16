import type { Metadata } from "next";
import { Suspense } from "react";
import ResetForm from "./ResetForm";

export const metadata: Metadata = { title: "Reset password" };

export default function ResetPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-950" />}>
      <ResetForm />
    </Suspense>
  );
}
