import { db } from "@/lib/db";

// Canonical set of portal pages that an admin can grant a moderator. Keep this
// list in sync with the AuthGuard pathname matcher below and the keys shown in
// the Platform Admin → Users → "Access" modal.
export const PORTAL_PAGES = [
  { key: "contacts",      label: "Contacts" },
  { key: "companies",     label: "Companies" },
  { key: "campaigns",     label: "Campaigns" },
  { key: "multi-channel", label: "Multi-channel" },
] as const;

export type PageKey = typeof PORTAL_PAGES[number]["key"];

/**
 * Idempotently create the moderator_page_access table. Called from every API
 * route that touches it; cheap on existing installs and removes the need for a
 * separate migration step.
 */
export async function ensureModeratorAccessTable() {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS moderator_page_access (
      user_id VARCHAR(64) NOT NULL PRIMARY KEY,
      pages   TEXT DEFAULT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}

/**
 * Returns the moderator's allowed page keys, or null if no override exists.
 * null = allow everything (legacy default — moderators have full portal
 * access until admin explicitly restricts them).
 */
export async function getModeratorPages(userId: string): Promise<string[] | null> {
  await ensureModeratorAccessTable();
  const [rows] = await db.execute(
    "SELECT pages FROM moderator_page_access WHERE user_id = ? LIMIT 1",
    [userId]
  );
  const raw = (rows as any[])[0]?.pages;
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(String(raw));
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((x) => typeof x === "string");
  } catch {
    return null;
  }
}

export async function setModeratorPages(userId: string, pages: string[]) {
  await ensureModeratorAccessTable();
  const allowed = new Set(PORTAL_PAGES.map((p) => p.key));
  const clean = pages.filter((p) => typeof p === "string" && allowed.has(p as PageKey));
  const json = JSON.stringify(clean);
  await db.execute(
    `INSERT INTO moderator_page_access (user_id, pages) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE pages = VALUES(pages)`,
    [userId, json]
  );
}

export async function clearModeratorPages(userId: string) {
  await ensureModeratorAccessTable();
  await db.execute("DELETE FROM moderator_page_access WHERE user_id = ?", [userId]);
}
