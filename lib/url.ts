/**
 * Normalize a user-entered external URL into a safe, clickable href.
 * Returns null for empty/whitespace. Prepends https:// when the value has no
 * scheme, so links like "linkedin.com/in/x" actually open instead of being
 * treated as a relative path. Rejects javascript:/data: schemes.
 */
export function externalUrl(value?: string | null): string | null {
  if (!value) return null;
  const v = String(value).trim();
  if (!v) return null;
  if (/^(javascript|data|vbscript):/i.test(v)) return null;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^\/\//.test(v)) return `https:${v}`;
  return `https://${v.replace(/^\/+/, "")}`;
}
