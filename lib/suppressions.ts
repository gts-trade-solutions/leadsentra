import { db } from "@/lib/db";

export type SuppressionType = "email" | "domain";

export type SuppressionSet = {
  emails: Set<string>;
  domains: Set<string>;
};

/**
 * Loads the full suppression set for a user into in-memory Sets, ready to
 * test recipient emails against in a tight loop.
 *
 * Caller pattern:
 *   const suppressed = await loadSuppressionSet(userId);
 *   const allowed = contacts.filter(c => !isSuppressed(c.email, suppressed));
 */
export async function loadSuppressionSet(userId: string): Promise<SuppressionSet> {
  // `corrected = 0` filter is critical: rows the admin has marked as
  // "manually corrected" stay in the table for audit but no longer block
  // future delivery to that address.
  const [rows] = await db.execute(
    "SELECT type, value FROM suppressions WHERE user_id = ? AND (corrected IS NULL OR corrected = 0)",
    [userId]
  );
  const emails = new Set<string>();
  const domains = new Set<string>();
  for (const r of rows as any[]) {
    const v = String(r.value || "").trim().toLowerCase();
    if (!v) continue;
    if (r.type === "email") emails.add(v);
    else if (r.type === "domain") domains.add(v.replace(/^@/, ""));
  }
  return { emails, domains };
}

/** Returns true if the email is on the user's email or domain suppression list. */
export function isSuppressed(email: string | null | undefined, set: SuppressionSet): boolean {
  if (!email) return false;
  const e = String(email).trim().toLowerCase();
  if (!e) return false;
  if (set.emails.has(e)) return true;
  const at = e.lastIndexOf("@");
  if (at < 0) return false;
  const domain = e.slice(at + 1);
  return set.domains.has(domain);
}

/** Strip leading "@" and lowercase a user-typed domain. */
export function normalizeDomain(raw: string): string {
  return String(raw || "").trim().toLowerCase().replace(/^@+/, "");
}

/** Basic email shape validation. */
export function isEmailShape(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/** Basic domain shape validation (no @, has a dot, lower-cased). */
export function isDomainShape(s: string): boolean {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(s);
}
