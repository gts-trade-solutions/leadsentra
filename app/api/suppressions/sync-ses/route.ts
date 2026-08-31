import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import {
  isSesConfigured,
  listSuppressedDestinations,
  checkConfigSet,
  type SuppressedDestination,
} from "@/lib/ses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET  /api/suppressions/sync-ses  → what a sync would do, plus config health
 * POST /api/suppressions/sync-ses  → do it
 *
 * WHY THIS EXISTS
 *
 * SES keeps its own account-level suppression list: a permanent bounce or a
 * complaint lands the address there and SES refuses to deliver to it from then
 * on.  LeadSentra keeps a separate per-user `suppressions` table, and the two
 * are only kept in step by the SNS webhook at /api/email/webhooks/ses.
 *
 * If SES_CONFIG_SET was never pointed at a configuration set with an SNS event
 * destination — the default — that webhook is never called.  SES then forwards
 * each bounce to the SENDER as a MAILER-DAEMON "Delivery Status Notification
 * (Failure)" email, the app learns nothing, the address stays mailable, and
 * the next campaign sends to it again.  That is the repeating-bounce loop:
 * the bounce notice arrives in a human inbox instead of the database.
 *
 * This route closes the loop from the other direction — it reads what SES
 * already knows and writes it into `suppressions`, so those addresses stop
 * being mailed even before the webhook is wired up.
 *
 * SCOPING: the SES list is per AWS ACCOUNT and is shared by every tenant of
 * this app.  Importing it wholesale would leak one customer's bounced contacts
 * into another's suppression list, so we only import addresses that appear in
 * the CALLING USER'S OWN campaign_recipients.
 */

type Preview = {
  ses_total: number;
  matched: number;
  already_suppressed: number;
  to_add: number;
  sample: { email: string; reason: string; last_update: string | null }[];
};

export async function GET() {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const health = await configHealth();
  if (!isSesConfigured()) {
    return NextResponse.json({ ...health, preview: null });
  }
  try {
    const preview = await buildPreview(session.id);
    return NextResponse.json({ ...health, preview });
  } catch (e: any) {
    return NextResponse.json({ ...health, preview: null, error: sesError(e) }, { status: 502 });
  }
}

export async function POST() {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isSesConfigured()) {
    return NextResponse.json(
      {
        error:
          "AWS SES is not configured on this server. Set AWS_ACCESS_KEY_ID, " +
          "AWS_SECRET_ACCESS_KEY and SES_REGION, then restart.",
      },
      { status: 400 }
    );
  }

  let suppressed;
  try {
    suppressed = await listSuppressedDestinations();
  } catch (e: any) {
    return NextResponse.json({ error: sesError(e) }, { status: 502 });
  }
  if (!suppressed.length) {
    return NextResponse.json({ ses_total: 0, added: 0, refreshed: 0, recipients_marked: 0 });
  }

  const byEmail = indexByEmail(suppressed);
  const mine = await mineOnly(session.id, suppressed.map((s) => s.email));
  if (!mine.length) {
    return NextResponse.json({
      ses_total: suppressed.length,
      added: 0,
      refreshed: 0,
      recipients_marked: 0,
      note: "None of the addresses SES has suppressed appear in your campaigns.",
    });
  }

  // Upsert in chunks — a single statement with 10k placeholders overflows
  // MySQL's max_allowed_packet on a large account.
  let added = 0;
  let refreshed = 0;
  for (const chunk of chunks(mine, 500)) {
    // Count what is already there BEFORE the upsert. Deriving it from
    // affectedRows does not work: ON DUPLICATE KEY UPDATE reports 1 per insert,
    // 2 per changed row and 0 per unchanged one, so the same number can mean
    // several different things.
    const ph = chunk.map(() => "?").join(",");
    const [[existingRow]] = (await db.query(
      `SELECT COUNT(*) AS n FROM suppressions
        WHERE user_id = ? AND type = 'email' AND value IN (${ph})`,
      [session.id, ...chunk]
    )) as any;
    const existing = Number(existingRow?.n || 0);

    const placeholders: string[] = [];
    const values: any[] = [];
    for (const email of chunk) {
      const s = byEmail[email];
      const isComplaint = s.reason.toUpperCase() === "COMPLAINT";
      placeholders.push("(?, 'email', ?, ?, ?)");
      values.push(
        session.id,
        email,
        `SES account suppression list · ${s.reason}${s.lastUpdate ? ` · ${s.lastUpdate.slice(0, 10)}` : ""}`.slice(0, 255),
        isComplaint ? "complaint" : "bounce"
      );
    }
    // ON DUPLICATE KEY UPDATE, not INSERT IGNORE: an address already on the
    // list but flagged `corrected` is skipped by loadSuppressionSet, so IGNORE
    // would leave it mailable. SES still refusing to deliver to it is proof the
    // correction was wrong, so clear the flag.
    await db.query(
      `INSERT INTO suppressions (user_id, type, value, reason, source)
            VALUES ${placeholders.join(",")}
       ON DUPLICATE KEY UPDATE
            reason       = VALUES(reason),
            source       = VALUES(source),
            corrected    = 0,
            corrected_at = NULL,
            updated_at   = NOW()`,
      values
    );
    added += chunk.length - existing;
    refreshed += existing;
  }

  // Reflect the truth on the recipient rows too, so the tracking pages stop
  // showing these sends as successful. Only rows that still claim success are
  // touched, and only the calling user's.
  let recipientsMarked = 0;
  for (const chunk of chunks(mine, 500)) {
    const ph = chunk.map(() => "?").join(",");
    const [res] = await db.query(
      `UPDATE campaign_recipients cr
         JOIN campaigns c ON c.id = cr.campaign_id
          SET cr.status        = 'bounced',
              cr.bounced_at    = COALESCE(cr.bounced_at, NOW()),
              cr.error_reason  = COALESCE(cr.error_reason, 'On the SES account suppression list (permanent bounce or complaint)'),
              cr.last_event_at = NOW()
        WHERE c.user_id = ?
          AND LOWER(cr.email) IN (${ph})
          AND cr.status IN ('sent', 'delivered', 'opened', 'clicked')
          -- Never overwrite proof of delivery. SES suppression is a statement
          -- about the address NOW; a send that was opened or clicked was
          -- demonstrably received at the time, and rewriting it to 'bounced'
          -- would erase real engagement and understate past campaigns.
          AND cr.opened_at IS NULL
          AND cr.clicked_at IS NULL
          AND cr.opens_count = 0
          AND cr.clicks_count = 0`,
      [session.id, ...chunk]
    );
    recipientsMarked += Number((res as any)?.affectedRows || 0);
  }

  return NextResponse.json({
    ses_total: suppressed.length,
    matched: mine.length,
    added,
    refreshed,
    recipients_marked: recipientsMarked,
  });
}

async function buildPreview(userId: string): Promise<Preview> {
  // Capped: this runs on every load of the Suppressions page, and paging the
  // whole list of a large SES account would make it crawl. POST does the full
  // pass. 20 pages x 1000 is plenty to tell the operator whether there is a
  // backlog worth importing.
  const suppressed = await listSuppressedDestinations({ maxPages: 20 });
  const byEmail = indexByEmail(suppressed);
  const mine = await mineOnly(userId, suppressed.map((s) => s.email));

  let alreadySuppressed = 0;
  if (mine.length) {
    for (const chunk of chunks(mine, 500)) {
      const ph = chunk.map(() => "?").join(",");
      const [[row]] = (await db.query(
        `SELECT COUNT(*) AS n FROM suppressions
          WHERE user_id = ? AND type = 'email' AND value IN (${ph})
            AND (corrected IS NULL OR corrected = 0)`,
        [userId, ...chunk]
      )) as any;
      alreadySuppressed += Number(row?.n || 0);
    }
  }

  return {
    ses_total: suppressed.length,
    matched: mine.length,
    already_suppressed: alreadySuppressed,
    to_add: Math.max(0, mine.length - alreadySuppressed),
    sample: mine.slice(0, 20).map((e) => {
      const s = byEmail[e];
      return { email: e, reason: s.reason, last_update: s.lastUpdate };
    }),
  };
}

/** Narrow an account-wide address list down to the ones this user has mailed. */
async function mineOnly(userId: string, emails: string[]): Promise<string[]> {
  const found = new Set<string>();
  for (const chunk of chunks(emails, 500)) {
    const ph = chunk.map(() => "?").join(",");
    const [rows] = await db.query(
      `SELECT DISTINCT LOWER(cr.email) AS email
         FROM campaign_recipients cr
         JOIN campaigns c ON c.id = cr.campaign_id
        WHERE c.user_id = ?
          AND LOWER(cr.email) IN (${ph})`,
      [userId, ...chunk]
    );
    for (const r of rows as any[]) found.add(String(r.email));
  }
  return Array.from(found);
}

async function configHealth() {
  const health = await checkConfigSet().catch(() => null);
  return {
    ses_configured: isSesConfigured(),
    config_set: health,
    // The single most useful thing to tell the operator: bounces are NOT
    // reaching the app, and here is why.
    webhook_live: !!health?.publishesBounces,
  };
}

function sesError(e: any): string {
  const name = e?.name || e?.Code || "";
  if (name === "AccessDeniedException" || /not authorized/i.test(String(e?.message))) {
    return "The AWS credentials are missing the ses:ListSuppressedDestinations permission.";
  }
  return e?.message || "Could not read the SES suppression list.";
}

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** email -> SES suppression record, without spreading a Map iterator (target: es5). */
function indexByEmail(list: SuppressedDestination[]): Record<string, SuppressedDestination> {
  const m: Record<string, SuppressedDestination> = {};
  for (const s of list) m[s.email] = s;
  return m;
}
