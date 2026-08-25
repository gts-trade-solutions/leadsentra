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

/**
 * The named HTML entities that turn up inside a scraped address. Deliberately
 * short: only the ones actually seen in the data, so an unrelated "&name;"
 * inside an address is left alone rather than guessed at.
 */
const EMAIL_ENTITIES: Record<string, string> = {
  commat: "@",
  period: ".",
  amp: "&",
  hyphen: "-",
  lowbar: "_",
  lpar: "(",
  rpar: ")",
};

/** A numeric entity's character, or the entity itself if it decodes to nothing. */
function entityChar(code: number, original: string): string {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return original;
  try {
    return String.fromCodePoint(code);
  } catch {
    return original;
  }
}

/**
 * Undo the encodings a scraped email address arrives wrapped in.
 *
 * Websites obfuscate their addresses to defeat scrapers: "info@x.com" is
 * published as "&#105;&#110;&#102;&#111;&#64;x&#46;com", "info&commat;x.com"
 * or "%69nfo%40x.com". A scraper that keeps the page's raw text keeps the
 * obfuscation with it, and what reaches the sheet is not an address at all —
 * it fails every format check, so it is stored but can never be mailed.
 *
 * Also strips the query string off a scraped mailto: link
 * ("info@x.com?subject=enquiry") and the punctuation a label leaves behind
 * (": sales@x.com").
 *
 * Every step is guarded: anything that does not decode is returned exactly as
 * it came in, so an address that was already clean is never altered.
 */
export function decodeEmail(value?: string | null): string | null {
  if (value === undefined || value === null) return null;
  let v = String(value);

  // &#x69; and &#105; and &commat;, in that order — a numeric entity can
  // decode to '&', and running the named pass last lets that one work too.
  v = v.replace(/&#x([0-9a-f]+);/gi, (m, hex) => entityChar(parseInt(hex, 16), m));
  v = v.replace(/&#(\d+);/g, (m, dec) => entityChar(parseInt(dec, 10), m));
  v = v.replace(/&([a-z]+);/gi, (m, name) => EMAIL_ENTITIES[name.toLowerCase()] ?? m);

  // %40 -> @. decodeURIComponent throws on a lone '%', which is why both the
  // test and the call are guarded — a stray percent must not lose the address.
  if (/%[0-9a-f]{2}/i.test(v)) {
    try {
      v = decodeURIComponent(v);
    } catch {
      /* not valid escaping after all; keep what we had */
    }
  }

  // "info@x.com?subject=website enquiry" — the mailto: link's query string,
  // scraped along with the address it belonged to.
  const query = v.indexOf("?");
  if (query > 0) v = v.slice(0, query);

  // Leading/trailing punctuation left by a label (": sales@x.com", "<a@b.com>").
  v = v.replace(/^[\s:;,.<>()\[\]-]+/, "").replace(/[\s:;,.<>()\[\]-]+$/, "");

  return v.trim();
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
