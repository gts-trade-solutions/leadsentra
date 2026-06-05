// components/SenderVerifyDrawer.tsx
'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import {
  startEmailVerify,
  checkEmailStatus,
  listIdentities,
  setDefaultIdentity,
  deleteIdentity,
  type EmailIdentityRow,
} from '@/lib/sender';

/**
 * Manage-senders drawer.
 *
 * Lists the account's verified + pending sender identities and lets the user:
 *   - add a new sender (display name + email) and verify it via SES,
 *   - set one as the default,
 *   - delete one.
 *
 * `onChanged(preferId?)` fires after any mutation so the parent can reload its
 * "Send from" picker; preferId lets the parent keep a just-touched sender
 * selected.
 */
export default function SenderManageDrawer({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onChanged?: (preferId?: string) => void;
}) {
  const [identities, setIdentities] = useState<EmailIdentityRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Add-sender form
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  // The id of the sender we just started verifying (so we can poll it).
  const [pendingId, setPendingId] = useState<string | null>(null);

  // Hold onChanged in a ref so `refresh` stays referentially stable even when
  // the parent passes a fresh inline callback each render — otherwise the
  // open-effect below would re-run forever and the list would flicker.
  const onChangedRef = useRef(onChanged);
  useEffect(() => { onChangedRef.current = onChanged; }, [onChanged]);

  const refresh = useCallback(async (preferId?: string) => {
    setLoading(true);
    try {
      const rows = await listIdentities();
      setIdentities(rows);
      onChangedRef.current?.(preferId);
    } catch (e: any) {
      setErrorMsg(e?.message || 'Failed to load senders');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setErrorMsg(null);
      setNewName('');
      setNewEmail('');
      setPendingId(null);
      refresh();
    }
  }, [open, refresh]);

  // While a freshly-added sender is pending, poll SES so its badge flips to
  // verified without the user reopening the drawer.
  useEffect(() => {
    if (!open || !pendingId) return;
    let cancelled = false;
    async function poll() {
      if (cancelled) return;
      try {
        const resp = await checkEmailStatus({ identityId: pendingId! });
        if (!cancelled && resp.status === 'verified') {
          setPendingId(null);
          await refresh(pendingId!);
        }
      } catch { /* transient — keep polling */ }
    }
    poll();
    const t = setInterval(poll, 4000);
    return () => { cancelled = true; clearInterval(t); };
  }, [open, pendingId, refresh]);

  async function handleAdd() {
    setErrorMsg(null);
    const email = newEmail.trim().toLowerCase();
    if (!email) return;
    setBusy(true);
    try {
      const resp = await startEmailVerify(email, newName.trim() || undefined);
      setNewName('');
      setNewEmail('');
      setPendingId(resp?.id ?? null);
      await refresh(resp?.id);
    } catch (e: any) {
      setErrorMsg(e?.message || 'Failed to start verification');
    } finally {
      setBusy(false);
    }
  }

  async function handleSetDefault(id: string) {
    setErrorMsg(null);
    setBusy(true);
    try {
      await setDefaultIdentity(id);
      await refresh(id);
    } catch (e: any) {
      setErrorMsg(e?.message || 'Failed to set default');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(row: EmailIdentityRow) {
    setErrorMsg(null);
    const label = row.display_name ? `"${row.display_name}" <${row.email}>` : row.email;
    if (!confirm(`Remove sender ${label}? This also removes it from SES.`)) return;
    setBusy(true);
    try {
      await deleteIdentity(row.id);
      await refresh();
    } catch (e: any) {
      setErrorMsg(e?.message || 'Failed to delete sender');
    } finally {
      setBusy(false);
    }
  }

  async function handleRefreshStatus(id: string) {
    setBusy(true);
    try {
      await checkEmailStatus({ identityId: id });
      await refresh(id);
    } catch (e: any) {
      setErrorMsg(e?.message || 'Failed to check status');
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-50" onClick={onClose}>
      <div
        className="absolute right-0 top-0 h-full w-full max-w-lg bg-gray-900 border-l border-gray-800 p-6 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white text-lg font-semibold">Manage senders</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
        </div>

        {errorMsg && (
          <div className="p-3 rounded border border-red-600 bg-red-900/20 text-red-200 text-sm mb-3">
            {errorMsg}
          </div>
        )}

        {/* ---- Existing senders ---- */}
        <div className="space-y-2 mb-6">
          {loading && identities.length === 0 && (
            <div className="text-sm text-gray-400">Loading…</div>
          )}
          {!loading && identities.length === 0 && (
            <div className="text-sm text-gray-400">No senders yet. Add one below.</div>
          )}
          {identities.map((i) => {
            const verified = i.status === 'verified';
            const isDefault = Number(i.is_default) === 1;
            return (
              <div
                key={i.id}
                className="p-3 rounded-lg border border-gray-700 bg-gray-800/50 flex items-center justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="text-sm text-white truncate">
                    {i.display_name ? (
                      <>
                        <span className="font-medium">&quot;{i.display_name}&quot;</span>{' '}
                        <span className="text-gray-300">&lt;{i.email}&gt;</span>
                      </>
                    ) : (
                      <span className="text-gray-200 break-all">{i.email}</span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs">
                    {verified ? (
                      <span className="text-emerald-400">✓ verified</span>
                    ) : (
                      <span className="text-yellow-400">{i.status}</span>
                    )}
                    {isDefault && (
                      <span className="px-1.5 py-0.5 rounded bg-emerald-900/40 text-emerald-300 border border-emerald-700">
                        default
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {!verified && (
                    <button
                      onClick={() => handleRefreshStatus(i.id)}
                      disabled={busy}
                      className="px-2.5 py-1 rounded text-xs bg-gray-700 border border-gray-600 text-gray-200 disabled:opacity-50"
                    >
                      Check
                    </button>
                  )}
                  {verified && !isDefault && (
                    <button
                      onClick={() => handleSetDefault(i.id)}
                      disabled={busy}
                      className="px-2.5 py-1 rounded text-xs bg-gray-700 border border-gray-600 text-gray-200 hover:border-emerald-600 disabled:opacity-50"
                    >
                      Make default
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(i)}
                    disabled={busy}
                    className="px-2.5 py-1 rounded text-xs bg-rose-900/30 border border-rose-700 text-rose-200 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* ---- Add a new sender ---- */}
        <div className="border-t border-gray-800 pt-4">
          <h3 className="text-sm font-semibold text-white mb-2">Add a sender</h3>
          <label className="block text-xs text-gray-400 mb-1">Display name (optional)</label>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Race Auto India"
            className="w-full px-3 py-2 mb-3 bg-gray-800 border border-gray-700 rounded-lg text-gray-200"
          />
          <label className="block text-xs text-gray-400 mb-1">Email address</label>
          <input
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            placeholder="marketing@yourbrand.com"
            type="email"
            className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-200"
          />
          <button
            onClick={handleAdd}
            disabled={!newEmail.trim() || busy}
            className="mt-3 px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Send verification email'}
          </button>
          <p className="text-xs text-gray-400 mt-2">
            SES emails the address a confirmation link. Once confirmed it appears above as
            <span className="text-emerald-400"> ✓ verified</span> and can be selected to send from.
          </p>
        </div>
      </div>
    </div>
  );
}
