"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

const DEFAULT_NEXT = "/portal/companies";

export default function SignInPage() {
  const router = useRouter();
  const search = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Surface email-verification + password-reset banners coming back from those flows
  const verified = search.get("verified") === "1";
  const passwordReset = search.get("reset") === "1";
  const verifyError = search.get("verifyError");
  const verifyNotice = verified
    ? "Email verified. You can sign in now."
    : passwordReset
    ? "Password updated. You can sign in with your new password."
    : verifyError === "expired"
    ? "Your verification link has expired. Please sign up again or request a new link."
    : verifyError === "invalid_token"
    ? "That verification link is invalid."
    : verifyError === "missing_token"
    ? "Missing verification token."
    : null;

  // If already signed in, bounce to next — unless we just signed out
  useEffect(() => {
    let alive = true;
    const justSignedOut = search.get("signedout") === "1";
    if (justSignedOut) return;

    fetch("/api/auth/me", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (d?.user) {
          const next = search.get("next") || DEFAULT_NEXT;
          router.replace(next);
        }
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [router, search]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Unable to sign in");

      const next = search.get("next") || DEFAULT_NEXT;
      router.replace(next);
      router.refresh();
    } catch (err: any) {
      setErrorMsg(err?.message ?? "Unable to sign in. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen grid place-items-center bg-gray-950 px-4">
      <div className="w-full max-w-md bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl">
        <h1 className="text-2xl font-semibold text-white">Sign in</h1>
        <p className="text-gray-400 mt-1 text-sm">
          Welcome back. Use your email and password to continue.
        </p>

        {verifyNotice && !errorMsg && (
          <div
            className={`mt-4 text-sm border rounded-lg p-3 ${
              verified || passwordReset
                ? "border-emerald-600 bg-emerald-900/20 text-emerald-200"
                : "border-amber-600 bg-amber-900/20 text-amber-200"
            }`}
          >
            {verifyNotice}
          </div>
        )}

        {errorMsg && (
          <div className="mt-4 text-sm border border-red-600 bg-red-900/20 text-red-200 rounded-lg p-3">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="signin-email" className="block text-sm text-gray-300 mb-1">Email</label>
            <input
              id="signin-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder="you@company.com"
              autoComplete="email"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="signin-password" className="block text-sm text-gray-300">Password</label>
              <Link href="/auth/forgot" className="text-xs text-emerald-400 hover:underline">
                Forgot password?
              </Link>
            </div>
            <input
              id="signin-password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-medium transition-colors"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-4 text-sm text-gray-400">
          Don’t have an account?{" "}
          <Link
            href="/auth/signup"
            className="text-emerald-400 hover:underline"
          >
            Create one
          </Link>
        </p>
      </div>
    </main>
  );
}
