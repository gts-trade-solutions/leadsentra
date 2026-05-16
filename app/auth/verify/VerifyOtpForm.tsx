"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";

const RESEND_COOLDOWN_SEC = 60;

export default function VerifyOtpForm() {
  const router = useRouter();
  const search = useSearchParams();

  const initialEmail = search.get("email") || "";
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendIn, setResendIn] = useState(RESEND_COOLDOWN_SEC);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [devWarning, setDevWarning] = useState<string | null>(null);

  // Pick up a dev-mode OTP that the signup or resend response stashed.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("lastDevOtp");
      if (!raw) return;
      const parsed = JSON.parse(raw) as { email: string; code: string; warning?: string | null };
      if (parsed?.email?.toLowerCase() === initialEmail.toLowerCase() && parsed?.code) {
        setDevCode(parsed.code);
        setDevWarning(parsed.warning || null);
      }
    } catch {
      // ignore
    }
  }, [initialEmail]);

  // Resend cooldown timer
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setInterval(() => setResendIn((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendIn]);

  // Auto-submit when 6 digits typed
  useEffect(() => {
    if (code.length === 6 && !submitting) {
      void submit(code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  async function submit(c: string) {
    if (!email) {
      setErrorMsg("Enter the email you signed up with.");
      return;
    }
    setSubmitting(true);
    setErrorMsg(null);
    setInfo(null);
    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email: email.trim().toLowerCase(), code: c }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErrorMsg(data?.error || "Verification failed");
        // Clear the code so they can try again
        setCode("");
        return;
      }
      // Verified + auto-logged-in. Off to the portal.
      router.replace("/portal/companies");
      router.refresh();
    } catch (e: any) {
      setErrorMsg(e?.message || "Network error");
      setCode("");
    } finally {
      setSubmitting(false);
    }
  }

  async function resend() {
    if (resendIn > 0 || resending) return;
    if (!email) {
      setErrorMsg("Enter your email first.");
      return;
    }
    setResending(true);
    setErrorMsg(null);
    setInfo(null);
    try {
      const res = await fetch("/api/auth/resend-otp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });
      const data = await res.json().catch(() => ({}));

      // Dev-mode: refresh the code we show to the user.
      if (data?.devCode) {
        setDevCode(String(data.devCode));
        setDevWarning(data?.emailWarning || null);
        try {
          sessionStorage.setItem(
            "lastDevOtp",
            JSON.stringify({
              email: email.trim().toLowerCase(),
              code: String(data.devCode),
              warning: data?.emailWarning || null,
            })
          );
        } catch {
          // ignore
        }
        setInfo("New code generated below.");
      } else {
        setInfo(data?.message || "If that email needs verification, a new code is on its way.");
      }
      setCode("");
      setResendIn(RESEND_COOLDOWN_SEC);
    } catch (e: any) {
      setErrorMsg(e?.message || "Could not resend code");
    } finally {
      setResending(false);
    }
  }

  return (
    <main className="min-h-screen grid place-items-center bg-gray-950 px-4">
      <div className="w-full max-w-md bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl">
        <div className="flex items-center gap-2 mb-2 text-emerald-400 text-xs font-semibold uppercase tracking-wider">
          <ShieldCheck className="w-4 h-4" />
          Email verification
        </div>
        <h1 className="text-2xl font-semibold text-white">Enter your code</h1>
        <p className="text-gray-400 mt-1 text-sm">
          We emailed a 6-digit code to{" "}
          <span className="text-gray-200 font-medium">{email || "your address"}</span>.
          It expires in 10 minutes.
        </p>

        {devCode && (
          <div className="mt-4 text-sm border border-amber-600 bg-amber-900/20 text-amber-100 rounded-lg p-3">
            <div className="font-semibold text-amber-200">Dev mode: email not configured</div>
            {devWarning && (
              <div className="text-xs text-amber-300 mt-1">{devWarning}</div>
            )}
            <div className="mt-2 flex items-center gap-3">
              <div className="font-mono text-2xl tracking-[0.5em] text-emerald-300 bg-gray-900 border border-gray-700 rounded-md px-3 py-1.5">
                {devCode}
              </div>
              <button
                type="button"
                onClick={() => setCode(devCode)}
                className="px-3 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-medium"
              >
                Use this code
              </button>
            </div>
            <div className="text-xs text-amber-300/80 mt-2">
              Set <code className="font-mono">RESEND_API_KEY</code> in <code className="font-mono">.env.local</code> to send real emails.
            </div>
          </div>
        )}

        {errorMsg && (
          <div className="mt-4 text-sm border border-red-600 bg-red-900/20 text-red-200 rounded-lg p-3">
            {errorMsg}
          </div>
        )}
        {info && !errorMsg && (
          <div className="mt-4 text-sm border border-emerald-600 bg-emerald-900/20 text-emerald-200 rounded-lg p-3">
            {info}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit(code);
          }}
          className="mt-6 space-y-5"
        >
          {!initialEmail && (
            <div>
              <label htmlFor="otp-email" className="block text-sm text-gray-300 mb-1">
                Email
              </label>
              <input
                id="otp-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="you@company.com"
                autoComplete="email"
              />
            </div>
          )}

          <div>
            <div className="text-sm text-gray-300 mb-2">6-digit code</div>
            <InputOTP
              maxLength={6}
              value={code}
              onChange={(v) => setCode(v.replace(/\D/g, ""))}
              disabled={submitting}
              inputMode="numeric"
              pattern="[0-9]*"
              autoFocus
              aria-label="One-time code"
              containerClassName="justify-center"
            >
              <InputOTPGroup>
                <InputOTPSlot
                  index={0}
                  className="h-12 w-12 text-lg bg-gray-800 border-gray-700 text-white"
                />
                <InputOTPSlot
                  index={1}
                  className="h-12 w-12 text-lg bg-gray-800 border-gray-700 text-white"
                />
                <InputOTPSlot
                  index={2}
                  className="h-12 w-12 text-lg bg-gray-800 border-gray-700 text-white"
                />
                <InputOTPSlot
                  index={3}
                  className="h-12 w-12 text-lg bg-gray-800 border-gray-700 text-white"
                />
                <InputOTPSlot
                  index={4}
                  className="h-12 w-12 text-lg bg-gray-800 border-gray-700 text-white"
                />
                <InputOTPSlot
                  index={5}
                  className="h-12 w-12 text-lg bg-gray-800 border-gray-700 text-white"
                />
              </InputOTPGroup>
            </InputOTP>
          </div>

          <button
            type="submit"
            disabled={submitting || code.length !== 6}
            className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium transition-colors"
          >
            {submitting ? "Verifying…" : "Verify & sign in"}
          </button>
        </form>

        <div className="mt-5 flex items-center justify-between text-sm">
          <button
            type="button"
            onClick={resend}
            disabled={resendIn > 0 || resending}
            className="text-emerald-400 hover:underline disabled:text-gray-500 disabled:no-underline disabled:cursor-not-allowed"
          >
            {resending
              ? "Sending…"
              : resendIn > 0
              ? `Resend code in ${resendIn}s`
              : "Resend code"}
          </button>
          <Link href="/auth/signin" className="text-gray-400 hover:text-white">
            Back to sign in
          </Link>
        </div>
      </div>
    </main>
  );
}
