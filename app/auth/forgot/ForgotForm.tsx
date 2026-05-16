"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function ForgotForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email }),
      });
      // The endpoint always returns ok (no enumeration); we show the same
      // confirmation message regardless of whether the email is registered.
      if (!res.ok) throw new Error("Request failed");
      setDone(true);
    } catch (err: any) {
      setErrorMsg(err?.message || "Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen grid place-items-center bg-gray-950 px-4">
      <div className="w-full max-w-md bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl">
        <h1 className="text-2xl font-semibold text-white">Reset your password</h1>
        <p className="text-gray-400 mt-1 text-sm">
          Enter the email tied to your account and we&apos;ll send a reset link.
        </p>

        {done ? (
          <div className="mt-6 text-sm border border-emerald-600 bg-emerald-900/20 text-emerald-200 rounded-lg p-3">
            If that email exists, we&apos;ve sent a reset link. Check your inbox (and dev console in development).
          </div>
        ) : (
          <>
            {errorMsg && (
              <div className="mt-4 text-sm border border-red-600 bg-red-900/20 text-red-200 rounded-lg p-3">
                {errorMsg}
              </div>
            )}

            <form onSubmit={onSubmit} className="mt-6 space-y-4">
              <div>
                <label htmlFor="forgot-email" className="block text-sm text-gray-300 mb-1">
                  Email
                </label>
                <input
                  id="forgot-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="you@company.com"
                  autoComplete="email"
                />
              </div>

              <button
                type="submit"
                disabled={loading || !email}
                className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium transition-colors"
              >
                {loading ? "Sending…" : "Send reset link"}
              </button>
            </form>
          </>
        )}

        <p className="mt-4 text-sm text-gray-400">
          <Link href="/auth/signin" className="inline-flex items-center gap-1 text-emerald-400 hover:underline">
            <ArrowLeft className="w-3 h-3" />
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
