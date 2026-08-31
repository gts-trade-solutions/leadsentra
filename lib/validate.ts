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
 * Local parts that are template text, not a person.
 *
 * These come off "contact us" pages where the address shown is an example the
 * site owner never replaced. Every one is a guaranteed hard bounce, and a hard
 * bounce is charged against the sending domain's reputation before anything
 * can suppress it — so they must be stopped at import, not after.
 *
 * Deliberately narrow. Ambiguous local parts that are often real — name, mail,
 * user, test, abc, demo, info — are NOT listed: losing a real lead costs more
 * than one bounce. Only wording that cannot plausibly be a mailbox is here.
 */
const PLACEHOLDER_LOCALS = new Set([
  "yourname", "your-name", "your_name", "your.name",
  "youremail", "your-email", "your_email", "your.email",
  "yourmail", "youraddress", "enteryouremail", "emailaddress",
  "firstname", "lastname", "firstname.lastname", "first.last",
  "firstname_lastname", "first_last",
  "john.doe", "johndoe", "jane.doe", "janedoe",
  "example", "sample", "placeholder", "dummy",
  "asdf", "qwerty", "xxx", "xxxx", "aaa",
]);

/**
 * Domains that can never receive mail.
 *
 * RFC 2606 / RFC 6761 reserve example.* and the .test/.invalid/.localhost TLDs
 * precisely so they can be used in documentation, which is exactly how they end
 * up in a scraped lead list. The rest are template wording.
 *
 * Note what is NOT here: business.com, email.com, mail.com and domain-like
 * names that belong to real companies with real staff. "yourname@business.com"
 * is caught by its local part instead, which costs nothing when the domain is
 * genuine.
 */
const PLACEHOLDER_DOMAINS = new Set([
  "example.com", "example.net", "example.org", "example.edu",
  "domain.com", "domainname.com",
  "yourdomain.com", "your-domain.com",
  "yourcompany.com", "your-company.com", "mycompany.com", "companyname.com",
  "yourwebsite.com", "yoursite.com", "yourbusiness.com",
]);

/** Reserved TLDs — nothing behind them accepts mail, by standard. */
const RESERVED_TLDS = new Set(["test", "invalid", "localhost", "example", "local"]);

/**
 * Basic address shape. Defined here rather than imported from lib/suppressions
 * so this module stays free of any database dependency — it is used in request
 * validation paths that must not open a connection.
 */
const EMAIL_SHAPE_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validate and normalise an email address from imported or user-typed data.
 *
 * Runs decodeEmail first, so an address the source site obfuscated
 * ("%20admin@x.com", "info&commat;x.com") is recovered rather than rejected —
 * those are real addresses wearing a disguise. What survives decoding is then
 * held to a real format check plus the placeholder rules above.
 *
 * Empty and placeholder input returns { value: null } with no error: a contact
 * without an email is allowed. Input that looks like it was MEANT to be an
 * address but cannot be one returns an error so the operator sees which row
 * was dropped and why.
 */
export function cleanEmail(value?: string | null): CleanResult {
  if (value === undefined || value === null) return { value: null };
  const original = String(value).trim();
  if (!original) return { value: null };
  // "n/a", "none", "-" in the email column: absence, not an error.
  if (isPlaceholder(original)) return { value: null };

  const decoded = (decodeEmail(original) || "").toLowerCase();
  if (!decoded) return { value: null };
  if (isPlaceholder(decoded)) return { value: null };

  const invalid = (why: string): CleanResult => ({
    value: null,
    error: `${why}: "${original}"`,
  });

  // Exactly one @, with something either side.
  const at = decoded.indexOf("@");
  if (at < 1 || at !== decoded.lastIndexOf("@") || at === decoded.length - 1) {
    return invalid("Invalid email format");
  }
  const local = decoded.slice(0, at);
  const domain = decoded.slice(at + 1);

  if (!EMAIL_SHAPE_RE.test(decoded)) return invalid("Invalid email format");
  // A dot cannot lead, trail, or double up on either side of the @.
  if (/^\.|\.$|\.\./.test(local) || /^\.|\.$|\.\.|^-|-$/.test(domain)) {
    return invalid("Invalid email format");
  }
  // The local part must contain something nameable. Punctuation alone is never
  // a mailbox, and stripping leading junk can leave exactly that: ".+@163.com"
  // decoded to "+@163.com", which passes every check above and would have been
  // written back as a "recovered" address and then mailed.
  if (!/[a-z0-9]/.test(local)) return invalid("Invalid email format");
  // The TLD must be letters — rules out "user@host.123" and bare hostnames.
  const tld = domain.slice(domain.lastIndexOf(".") + 1);
  if (!/^[a-z]{2,}$/.test(tld)) return invalid("Invalid email domain");
  if (RESERVED_TLDS.has(tld)) return invalid("Reserved domain that cannot receive mail");
  if (PLACEHOLDER_DOMAINS.has(domain)) return invalid("Placeholder domain");
  if (PLACEHOLDER_LOCALS.has(local)) return invalid("Placeholder email address");

  // A long run of pure hex is an anti-scraping token, most often Cloudflare's
  // email-obfuscation payload lifted verbatim off the page. It is never a
  // mailbox, and mailing it can land the sender in a spam trap.
  if (/^[0-9a-f]{16,}$/.test(local)) {
    return invalid("Obfuscation token, not an address");
  }

  return { value: decoded };
}

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
