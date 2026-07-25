/**
 * Shared cleaning + validation for user-supplied phone numbers and
 * social/profile URLs (contacts and companies, single-add / edit / bulk import).
 *
 * Two failure modes are handled differently:
 *
 *  - Placeholder junk ("not provided", "n/a", "na", "-", "none", …) is treated
 *    as empty and silently cleared to NULL. Uploaded lead lists are full of
 *    these; they used to be stored verbatim and then rendered as clickable
 *    links like https://not%20provided.
 *  - A real-looking value that still fails validation (a phone full of
 *    letters, a "LinkedIn" URL pointing at another site) returns an `error`
 *    so forms can surface the typo instead of saving garbage.
 */

const PLACEHOLDER_RE =
  /^(?:n\.?\/?a\.?|none|nil|null|no|nan|not[\s_-]*provided|not[\s_-]*available|not[\s_-]*found|not[\s_-]*applicable|no[\s_-]+(?:linkedin|phone|url|website|profile|number|email|contact)|unknown|unavailable|tbd|tba|pending|x{2,}|[-–—.,_/\\]+|0+)$/i;

/** True when the value is a "there is no value" placeholder, not real data. */
export function isPlaceholder(value: string): boolean {
  return PLACEHOLDER_RE.test(value.trim());
}

export type CleanResult = { value: string | null; error?: string };

/**
 * Validate/normalise a phone number. Placeholders and empties come back as
 * { value: null }; a value that survives must be digits with the usual
 * punctuation (+ ( ) . - / spaces) plus an optional ext/x extension, and
 * carry 7–20 digits (the upper bound tolerates "021-555777 / 021-555888"
 * style double numbers that CRM data often holds in one cell).
 */
export function cleanPhone(value?: string | null): CleanResult {
  if (value === undefined || value === null) return { value: null };
  const v = String(value).trim();
  if (!v || isPlaceholder(v)) return { value: null };

  const digits = v.replace(/\D/g, "");
  const shape = /^\+?[0-9(][0-9\s().\/+-]*(?:(?:ext\.?|x|#)\s*[0-9]{1,6})?$/i;
  if (!shape.test(v) || digits.length < 7 || digits.length > 20) {
    return { value: null, error: `Invalid phone number: "${v}"` };
  }
  return { value: v };
}

export type UrlPlatform = "linkedin" | "facebook" | "instagram";

const PLATFORM_HOSTS: Record<UrlPlatform, RegExp> = {
  linkedin: /(^|\.)linkedin\.com$/i,
  facebook: /(^|\.)(facebook\.com|fb\.com|fb\.me)$/i,
  instagram: /(^|\.)(instagram\.com|instagr\.am)$/i,
};

const PLATFORM_LABEL: Record<UrlPlatform, string> = {
  linkedin: "LinkedIn",
  facebook: "Facebook",
  instagram: "Instagram",
};

/**
 * Validate/normalise an external URL. Placeholders and empties come back as
 * { value: null }. Bare domains get an https:// prefix (matching lib/url.ts
 * externalUrl). When `platform` is given, the hostname must belong to that
 * network — "linkedin.com/in/jane" passes, "twitter.com/jane" in the
 * LinkedIn column does not.
 */
export function cleanUrl(
  value?: string | null,
  platform?: UrlPlatform,
  label = "URL"
): CleanResult {
  if (value === undefined || value === null) return { value: null };
  let v = String(value).trim();
  if (!v || isPlaceholder(v)) return { value: null };

  if (/^(javascript|data|vbscript):/i.test(v)) {
    return { value: null, error: `Invalid ${label}: "${value}"` };
  }
  if (/^\/\//.test(v)) v = `https:${v}`;
  if (!/^https?:\/\//i.test(v)) v = `https://${v.replace(/^\/+/, "")}`;

  let host = "";
  try {
    host = new URL(v).hostname;
  } catch {
    return { value: null, error: `Invalid ${label}: "${String(value).trim()}"` };
  }
  // A hostname without a dot ("https://notprovided") is never a real site.
  if (!host.includes(".") || /\s/.test(v)) {
    return { value: null, error: `Invalid ${label}: "${String(value).trim()}"` };
  }
  if (platform && !PLATFORM_HOSTS[platform].test(host)) {
    return {
      value: null,
      error: `Not a ${PLATFORM_LABEL[platform]} URL: "${String(value).trim()}"`,
    };
  }
  return { value: v };
}
