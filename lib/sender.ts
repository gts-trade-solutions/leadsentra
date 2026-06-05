export type EmailIdentityRow = {
  id: string;
  email: string;
  display_name?: string | null;
  status: 'pending' | 'verified' | 'failed';
  is_default?: boolean | number | null;
  verified_at: string | null;
  changes_used: number | null;
};

export function changesLeft(row?: EmailIdentityRow | null, limit = 2) {
  const used = row?.changes_used ?? 0;
  return Math.max(0, limit - used);
}

export async function getMySender(): Promise<EmailIdentityRow | null> {
  const res = await fetch('/api/email/sender', { credentials: 'same-origin' });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('getMySender failed');
  const j = await res.json().catch(() => ({}));
  return (j?.sender ?? null) as EmailIdentityRow | null;
}

/** List ALL of the user's sender identities (verified + pending), default first. */
export async function listIdentities(): Promise<EmailIdentityRow[]> {
  const res = await fetch('/api/email/identities', { credentials: 'same-origin', cache: 'no-store' });
  if (!res.ok) throw new Error('listIdentities failed');
  const j = await res.json().catch(() => ({}));
  return (Array.isArray(j?.identities) ? j.identities : []) as EmailIdentityRow[];
}

/** Mark one identity as the user's default sender. */
export async function setDefaultIdentity(id: string): Promise<void> {
  const res = await fetch('/api/email/identities', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ id, action: 'default' }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json?.error || 'setDefaultIdentity failed');
  }
}

/** Remove a sender identity (also best-effort removes it from SES). */
export async function deleteIdentity(id: string): Promise<void> {
  const res = await fetch(`/api/email/identities/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    throw new Error(json?.error || 'deleteIdentity failed');
  }
}

/** Start verifying a new sender.  `name` is the optional friendly From name. */
export async function startEmailVerify(email: string, name?: string): Promise<any> {
  const res = await fetch('/api/email/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ email, name }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json?.error || 'startEmailVerify failed'), { status: res.status, json });
  return json;
}

export async function checkEmailStatus(args: { identityId?: string; email?: string }): Promise<any> {
  const res = await fetch('/api/email/status', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(args),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(json?.error || 'checkEmailStatus failed'), { status: res.status, json });
  return json;
}
