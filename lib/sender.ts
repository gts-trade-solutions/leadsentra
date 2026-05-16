export type EmailIdentityRow = {
  id: string;
  email: string;
  status: 'pending' | 'verified' | 'failed';
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

export async function startEmailVerify(email: string): Promise<any> {
  const res = await fetch('/api/email/start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ email }),
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
