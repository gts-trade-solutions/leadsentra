'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Check, X } from 'lucide-react';
import { validatePassword } from '@/lib/password';

export default function SignUpPage() {
  const router = useRouter();
  const search = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // If already signed in, bounce to next or /companies
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'same-origin' })
      .then((r) => r.json())
      .then((d) => {
        if (d?.user) {
          const next = search.get('next') || '/portal/companies';
          router.replace(next);
        }
      })
      .catch(() => {});
  }, [router, search]);

  // Live password complexity checks (mirror lib/password.ts)
  const pwChecks = useMemo(
    () => ({
      length: password.length >= 12,
      lower: /[a-z]/.test(password),
      upper: /[A-Z]/.test(password),
      number: /[0-9]/.test(password),
    }),
    [password]
  );
  const pwValid = pwChecks.length && pwChecks.lower && pwChecks.upper && pwChecks.number;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setNotice(null);

    const pwError = validatePassword(password);
    if (pwError) {
      setErrorMsg(pwError);
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Unable to sign up');

      setPassword('');

      // OTP step removed — register now creates the account and sets the
      // session cookie in one call, so we land the user directly in the
      // portal. Honor ?next= if a deep link bounced them here.
      const next = search.get('next') || '/portal/companies';
      router.replace(next);
    } catch (err: any) {
      setErrorMsg(err?.message ?? 'Unable to sign up. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen grid place-items-center bg-gray-950 px-4">
      <div className="w-full max-w-md bg-gray-900 border border-gray-800 rounded-2xl p-6 shadow-xl">
        <h1 className="text-2xl font-semibold text-white">Create account</h1>
        <p className="text-gray-400 mt-1 text-sm">
          Start sending campaigns with your verified sender.
        </p>

        {errorMsg && (
          <div className="mt-4 text-sm border border-red-600 bg-red-900/20 text-red-200 rounded-lg p-3">
            {errorMsg}
          </div>
        )}

        {notice && (
          <div className="mt-4 text-sm border border-emerald-600 bg-emerald-900/20 text-emerald-200 rounded-lg p-3">
            {notice}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm text-gray-300 mb-1">Email</label>
            <input
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
            <label className="block text-sm text-gray-300 mb-1">Password</label>
            <input
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
                <Requirement ok={pwChecks.length} text="At least 12 characters" />
                <Requirement ok={pwChecks.lower} text="A lowercase letter" />
                <Requirement ok={pwChecks.upper} text="An uppercase letter" />
                <Requirement ok={pwChecks.number} text="A number" />
              </ul>
            )}
          </div>

          <button
            type="submit"
            disabled={loading || !pwValid || !email}
            className="w-full py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium transition-colors"
          >
            {loading ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="mt-4 text-sm text-gray-400">
          Already have an account?{' '}
          <Link href="/auth/signin" className="text-emerald-400 hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}

function Requirement({ ok, text }: { ok: boolean; text: string }) {
  return (
    <li
      className={`flex items-center gap-2 ${
        ok ? 'text-emerald-300' : 'text-gray-400'
      }`}
    >
      {ok ? <Check className="w-3.5 h-3.5" /> : <X className="w-3.5 h-3.5" />}
      {text}
    </li>
  );
}
