"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Check, X } from "lucide-react";
import { validatePassword } from "@/lib/password";

export default function ResetForm() {
  const router = useRouter();
  const search = useSearchParams();
  const token = search.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const checks = useMemo(
    () => ({
      length: password.length >= 12,
      lower: /[a-z]/.test(password),
      upper: /[A-Z]/.test(password),
      number: /[0-9]/.test(password),
      match: password.length > 0 && password === confirm,
    }),
    [password, confirm]
  );
  const allOk = checks.length && checks.lower && checks.upper && checks.number && checks.match;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);

    const pwError = validatePassword(password);
    if (pwError) { setErrorMsg(pwError); return; }
    if (password !== confirm) { setErrorMsg("Passwords don't match"); return; }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || "Reset failed");
      setDone(true);
      setTimeout(() => router.replace("/auth/signin?reset=1"), 1500);
    } catch (err: any) {
      setErrorMsg(err?.message || "Reset failed");
    } finally {
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <main className="min-h-screen grid place-items-center bg-gray-950 px-4">
        <div className="w-full max-w-md bg-gray-900 border border-gray-800 rounded-2xl p-6 text-center">
          <h1 className="text-xl font-semibold text-red-300">Missing token</h1>
          <p className="text-gray-400 mt-2 text-sm">
            Use the link in your password-reset email, or
            <Link href="/auth/forgot" className="text-emerald-400 hover:underline ml-1">
              request a new one
            </Link>.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen grid place-items-center bg-gray-950 px-4">
      <div className="w-full max-w-md bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl">
        <h1 className="text-2xl font-semibold text-white">Set a new password</h1>
        <p className="text-gray-400 mt-1 text-sm">
          Pick something you haven&apos;t used here before.
        </p>

        {done && (
          <div className="mt-4 text-sm border border-emerald-600 bg-emerald-900/20 text-emerald-200 rounded-lg p-3">
            Password updated. Redirecting to sign-in…
          </div>
        )}

        {errorMsg && !done && (
          <div className="mt-4 text-sm border border-red-600 bg-red-900/20 text-red-200 rounded-lg p-3">
            {errorMsg}
          </div>
        )}

        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="reset-password" className="block text-sm text-gray-300 mb-1">
              New password
            </label>
            <input
              id="reset-password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder="At least 12 characters"
              autoComplete="new-password"
            />
            {password.length > 0 && (
              <ul className="mt-2 text-xs space-y-1">
                <Req ok={checks.length} text="At least 12 characters" />
                <Req ok={checks.lower} text="A lowercase letter" />
                <Req ok={checks.upper} text="An uppercase letter" />
                <Req ok={checks.number} text="A number" />
              </ul>
            )}
          </div>

          <div>
            <label htmlFor="reset-confirm" className="block text-sm text-gray-300 mb-1">
              Confirm password
            </label>
            <input
              id="reset-confirm"
              type="password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              autoComplete="new-password"
            />
            {confirm.length > 0 && (
              <p className={`mt-1 text-xs ${checks.match ? "text-emerald-300" : "text-red-300"}`}>
                {checks.match ? "Passwords match" : "Passwords don't match yet"}
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={loading || !allOk || done}
            className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium transition-colors"
          >
            {loading ? "Updating…" : "Set new password"}
          </button>
        </form>

        <p className="mt-4 text-sm text-gray-400">
          <Link href="/auth/signin" className="text-emerald-400 hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}

function Req({ ok, text }: { ok: boolean; text: string }) {
  return (
    <li className={`flex items-center gap-2 ${ok ? "text-emerald-300" : "text-gray-400"}`}>
      {ok ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
      {text}
    </li>
  );
}
