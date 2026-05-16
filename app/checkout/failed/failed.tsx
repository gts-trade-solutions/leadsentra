"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  XCircle,
  ArrowLeft,
  RefreshCcw,
  Home,
  LayoutDashboard,
  HelpCircle,
  Mail,
  ShieldCheck,
  CreditCard,
} from "lucide-react";

function FailedInner() {
  const router = useRouter();
  const search = useSearchParams();

  const reason = search.get("reason");
  const orderId = search.get("order_id");
  const lastCredits = search.get("credits");

  const tryAgainHref = lastCredits
    ? `/checkout?credits=${encodeURIComponent(lastCredits)}`
    : "/#pricing";

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center p-4 sm:p-8">
      <div className="w-full max-w-2xl">
        <div className="rounded-2xl border border-red-900/50 bg-gradient-to-b from-gray-900 to-gray-950 shadow-2xl">
          <div className="p-8 sm:p-10 flex flex-col items-center text-center border-b border-gray-800">
            <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center mb-4">
              <XCircle className="w-8 h-8 text-red-400" />
            </div>
            <h1 className="text-3xl sm:text-4xl font-bold text-red-400">
              Payment Cancelled or Failed
            </h1>
            <p className="text-gray-300 mt-3 max-w-md">
              Don&apos;t worry — <span className="text-emerald-300 font-medium">no money was taken</span>.
              You can retry your purchase or come back to it later.
            </p>

            {(reason || orderId) && (
              <div className="mt-5 w-full max-w-md text-left bg-gray-900/60 border border-gray-800 rounded-lg p-3 text-xs text-gray-400 space-y-1">
                {orderId && (
                  <div>
                    <span className="text-gray-500">Order ID:</span>{" "}
                    <span className="font-mono text-gray-300 break-all">{orderId}</span>
                  </div>
                )}
                {reason && (
                  <div>
                    <span className="text-gray-500">Reason:</span>{" "}
                    <span className="text-gray-300">{reason}</span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="p-6 sm:p-8 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Link
              href={tryAgainHref}
              className="flex items-center gap-3 px-4 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 transition-colors"
            >
              <RefreshCcw className="w-5 h-5" />
              <div>
                <div className="font-semibold text-white">Try again</div>
                <div className="text-xs text-emerald-100/80">
                  {lastCredits ? `Resume ${lastCredits} credits` : "Pick a plan"}
                </div>
              </div>
            </Link>

            <Link
              href="/portal/companies"
              className="flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-800 hover:bg-gray-700 border border-gray-700 transition-colors"
            >
              <LayoutDashboard className="w-5 h-5 text-gray-300" />
              <div>
                <div className="font-semibold text-white">Go to Portal</div>
                <div className="text-xs text-gray-400">Continue without buying</div>
              </div>
            </Link>

            <Link
              href="/portal/billing"
              className="flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-800 hover:bg-gray-700 border border-gray-700 transition-colors"
            >
              <CreditCard className="w-5 h-5 text-gray-300" />
              <div>
                <div className="font-semibold text-white">Billing history</div>
                <div className="text-xs text-gray-400">See past transactions</div>
              </div>
            </Link>

            <Link
              href="/"
              className="flex items-center gap-3 px-4 py-3 rounded-xl bg-gray-800 hover:bg-gray-700 border border-gray-700 transition-colors"
            >
              <Home className="w-5 h-5 text-gray-300" />
              <div>
                <div className="font-semibold text-white">Back to home</div>
                <div className="text-xs text-gray-400">Marketing site</div>
              </div>
            </Link>
          </div>

          <div className="px-6 sm:px-8 pb-6">
            <div className="rounded-xl bg-gray-900/60 border border-gray-800 p-4">
              <div className="flex items-center gap-2 mb-2">
                <HelpCircle className="w-4 h-4 text-amber-300" />
                <h3 className="text-sm font-semibold text-gray-200">
                  Common reasons a payment fails
                </h3>
              </div>
              <ul className="text-xs text-gray-400 space-y-1.5 list-disc list-inside">
                <li>Card declined by issuer (try another card or use UPI/netbanking).</li>
                <li>OTP / 3-D Secure not completed within the time window.</li>
                <li>Insufficient balance or international payments disabled.</li>
                <li>Window closed before confirmation.</li>
              </ul>
            </div>
          </div>

          <div className="px-6 sm:px-8 pb-8">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-gray-500">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>Secure checkout via Razorpay. We never store card details.</span>
              </div>
              <a
                href="mailto:info@raceinnovations.in"
                className="inline-flex items-center gap-1 text-emerald-400 hover:underline"
              >
                <Mail className="w-3.5 h-3.5" />
                Email support
              </a>
            </div>
          </div>
        </div>

        <div className="mt-5 text-center">
          <button
            type="button"
            onClick={() => router.back()}
            className="inline-flex items-center gap-2 text-sm text-gray-400 hover:text-white"
          >
            <ArrowLeft className="w-4 h-4" />
            Go back
          </button>
        </div>
      </div>
    </div>
  );
}

export default function FailedPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-950" />}>
      <FailedInner />
    </Suspense>
  );
}
