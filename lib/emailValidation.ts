import { promises as dns } from "node:dns";

/**
 * Pre-send DNS check: can this domain receive mail at all?
 *
 * A large share of repeating hard bounces are not "mailbox does not exist" but
 * "domain does not exist" — a typo (gmial.com), a company that folded, or a
 * scraped address whose domain never had mail. Every one of those is a
 * guaranteed permanent bounce, and every permanent bounce is charged against
 * the SES account reputation before anyone can suppress it.
 *
 * Checking MX before the send costs one cached DNS lookup per DOMAIN and stops
 * the bounce from ever being generated.
 *
 * The check is deliberately conservative. Only a definitive "this name does not
 * exist / has no mail records" answer blocks a send. A timeout, a SERVFAIL, or
 * any other resolver trouble returns "unknown" and the mail goes out — a flaky
 * resolver must never silently swallow a customer's campaign.
 */

export type MxVerdict = "ok" | "no-mx" | "unknown";

type CacheEntry = { verdict: MxVerdict; at: number };

// Domains repeat constantly inside one campaign, and across campaigns within a
// process. Positive answers are held longer than negative ones so a domain that
// has just fixed its DNS recovers quickly.
const CACHE = new Map<string, CacheEntry>();
const TTL_OK_MS = 6 * 60 * 60 * 1000;   // 6 hours
const TTL_BAD_MS = 30 * 60 * 1000;      // 30 minutes

/** Resolver errors that mean "this name definitively has no such records". */
const DEFINITIVE = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN"]);

function cached(domain: string): MxVerdict | null {
  const hit = CACHE.get(domain);
  if (!hit) return null;
  const ttl = hit.verdict === "ok" ? TTL_OK_MS : TTL_BAD_MS;
  if (Date.now() - hit.at > ttl) {
    CACHE.delete(domain);
    return null;
  }
  return hit.verdict;
}

function remember(domain: string, verdict: MxVerdict): MxVerdict {
  // "unknown" is never cached — it means we failed to find out, and the next
  // attempt deserves a fresh try rather than inheriting a transient failure.
  if (verdict !== "unknown") CACHE.set(domain, { verdict, at: Date.now() });
  return verdict;
}

/** Can `domain` accept mail?  See MxVerdict for what each answer means. */
export async function checkDomainMx(domain: string): Promise<MxVerdict> {
  const d = String(domain || "").trim().toLowerCase();
  if (!d || !d.includes(".")) return "no-mx";

  const hit = cached(d);
  if (hit) return hit;

  try {
    const mx = await dns.resolveMx(d);
    if (mx && mx.length > 0 && mx.some((r) => r.exchange && r.exchange !== ".")) {
      return remember(d, "ok");
    }
    // Empty MX set — fall through to the implicit-MX check below.
  } catch (e: any) {
    if (!DEFINITIVE.has(e?.code)) return "unknown";
    // ENOTFOUND/ENODATA on MX is not yet proof: RFC 5321 §5.1 says a host with
    // an A/AAAA record but no MX still accepts mail at that address.
  }

  try {
    const a = await dns.resolve4(d);
    if (a && a.length) return remember(d, "ok");
  } catch (e: any) {
    if (!DEFINITIVE.has(e?.code)) return "unknown";
  }

  try {
    const aaaa = await dns.resolve6(d);
    if (aaaa && aaaa.length) return remember(d, "ok");
  } catch (e: any) {
    if (!DEFINITIVE.has(e?.code)) return "unknown";
  }

  // No MX, no A, no AAAA, and every answer was definitive: mail to this domain
  // can only bounce.
  return remember(d, "no-mx");
}

/** Domain part of an address, lower-cased.  Null when the address is malformed. */
export function domainOf(email: string | null | undefined): string | null {
  const e = String(email || "").trim().toLowerCase();
  const at = e.lastIndexOf("@");
  if (at < 1 || at === e.length - 1) return null;
  return e.slice(at + 1);
}

/**
 * Verdict for one address.  "no-mx" here means a send is a guaranteed bounce.
 * Callers should skip and suppress rather than hand it to the provider.
 */
export async function checkEmailDeliverable(email: string): Promise<MxVerdict> {
  const domain = domainOf(email);
  if (!domain) return "no-mx";
  return checkDomainMx(domain);
}

/** Test seam — lets a test start from a clean cache. */
export function _resetMxCache() {
  CACHE.clear();
}
