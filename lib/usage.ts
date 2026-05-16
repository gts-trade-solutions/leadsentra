import { db } from "@/lib/db";

/**
 * Best-effort logger for social-connection usage events.
 * Writes to `analytics_events` so it doesn't conflict with the
 * `social_connection_usage` table (which counts identity changes, not events).
 */
export async function logUsage(
  userId: string,
  provider: string,
  event: string,
  metadata: any = {}
): Promise<void> {
  try {
    await db.execute(
      `INSERT INTO analytics_events (user_id, provider, event_type, meta)
       VALUES (?, ?, ?, CAST(? AS JSON))`,
      [userId, provider, event, JSON.stringify(metadata ?? {})]
    );
  } catch {
    // best-effort, ignore
  }
}
