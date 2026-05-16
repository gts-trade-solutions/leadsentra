"use client";
import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";

export default function SuccessPage() {
  const qp = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState("Verifying payment…");
  const [credited, setCredited] = useState(0);
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const payment_id = qp.get("razorpay_payment_id");
      const order_id = qp.get("razorpay_order_id");
      const signature = qp.get("razorpay_signature");

      if (!payment_id || !order_id || !signature) {
        setStatus("Missing payment details.");
        return;
      }

      const res = await fetch("/api/payments/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          razorpay_payment_id: payment_id,
          razorpay_order_id: order_id,
          razorpay_signature: signature,
        }),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data?.verified) {
        setStatus(
          "Verification failed. If amount was deducted, we will auto-credit after webhook."
        );
        return;
      }

      setCredited(data.credited || 0);
      setBalance(data.balance ?? null);
      setStatus("Payment verified ✔ Credits added instantly.");
    })();
  }, [qp]);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 flex items-center justify-center p-8">
      <div className="max-w-lg text-center">
        <h1 className="text-3xl font-bold text-emerald-400">
          Checkout Success
        </h1>
        <p className="text-gray-300 mt-2">{status}</p>

        {credited > 0 && (
          <p className="text-sm text-gray-400 mt-3">
            Added{" "}
            <span className="text-emerald-300 font-semibold">{credited}</span>{" "}
            credits to your wallet.
            {balance != null && (
              <>
                {" "}
                New balance:{" "}
                <span className="text-emerald-300 font-semibold">
                  {balance}
                </span>
                .
              </>
            )}
          </p>
        )}

        <div className="mt-6 flex gap-3 justify-center">
          <button
            onClick={() => router.push("/portal/companies")}
            className="bg-emerald-600 hover:bg-emerald-700 rounded-lg px-4 py-2 font-medium"
          >
            Go to Portal
          </button>
          <button
            onClick={() => router.push("/")}
            className="bg-gray-800 hover:bg-gray-700 rounded-lg px-4 py-2 font-medium"
          >
            Back to Home
          </button>
        </div>
      </div>
    </div>
  );
}
