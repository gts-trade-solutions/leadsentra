// components/SenderVerifyDrawer.tsx
'use client';
import { useEffect, useState } from 'react';
import { startEmailVerify, checkEmailStatus } from '@/lib/sender';

export default function SenderVerifyDrawer({ open, onClose }: { open: boolean; onClose: () => void; }) {
  const [email, setEmail] = useState('');
  const [identityId, setIdentityId] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'pending' | 'verified' | 'failed'>('idle');
  const [mode, setMode] = useState<'auth' | 'public' | 'idle'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setEmail(''); setIdentityId(null); setStatus('idle'); setMode('idle'); setErrorMsg(null);
    }
  }, [open]);

  async function handleStart() {
    setErrorMsg(null);
    try {
      const resp = await startEmailVerify(email);
      setMode(resp.mode);
      if (resp.mode === 'auth') setIdentityId(resp.id ?? null);
      setStatus('pending');
    } catch (e: any) {
      setErrorMsg(e?.message || 'Failed to start verification');
    }
  }

  async function pollOnce() {
    setErrorMsg(null);
    try {
      const resp = await checkEmailStatus(
        mode === 'auth' && identityId ? { identityId } : { email }
      );
      setStatus(resp.status);
    } catch (e: any) {
      setErrorMsg(e?.message || 'Failed to check status');
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-50">
      <div className="absolute right-0 top-0 h-full w-full max-w-lg bg-gray-900 border-l border-gray-800 p-6 overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white text-lg font-semibold">Verify sender email</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
        </div>

        {mode === 'public' && (
          <div className="p-3 rounded border border-amber-600 bg-amber-900/20 text-amber-200 text-sm mb-3">
            You’re not signed in — we’ll verify via SES but nothing will be saved to your account until you log in.
          </div>
        )}

        {errorMsg && (
          <div className="p-3 rounded border border-red-600 bg-red-900/20 text-red-200 text-sm mb-3">
            {errorMsg}
          </div>
        )}

        <label className="block text-sm text-gray-300 mb-2">Your email address</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@brand.com"
          className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200" />

        <button onClick={handleStart} disabled={!email}
          className="mt-3 px-4 py-2 rounded bg-emerald-600 text-white">
          Send verification email
        </button>

        {status !== 'idle' && (
          <div className="mt-6 flex items-center justify-between">
            <div className="text-sm text-gray-300">
              Status: <span className={status === 'verified' ? 'text-emerald-400' : status === 'failed' ? 'text-red-400' : 'text-yellow-400'}>{status}</span>
            </div>
            <button onClick={pollOnce} className="px-3 py-1.5 rounded bg-gray-800 border border-gray-700 text-gray-200">
              Refresh
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
