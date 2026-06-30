// Shared helper for company "departments" (e.g. "LBI", "Research"), stored as
// a JSON array under companies.meta.departments and edited from the Companies
// page. Lives in lib/ (not a route file) so both the create and update routes
// can import it — Next.js route modules may only export request handlers.

/**
 * Normalize a departments payload into a clean string[]:
 * trims each entry, drops blanks, and de-dupes case-insensitively
 * (keeping the first-seen casing and the user's original order).
 */
export function cleanDepartments(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const v = typeof raw === "string" ? raw.trim() : "";
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}
