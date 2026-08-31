/**
 * ONE definition of every campaign number, shared by every surface that shows
 * them.
 *
 * Before this file the app had four different answers for "delivered":
 *
 *   /api/campaigns/metrics          sent + delivered + opened + clicked
 *   /api/campaigns/[id]/progress    delivered + opened + clicked   (no 'sent')
 *   /api/email-status               status = 'delivered' only
 *   campaigns/[id]/Tracking.tsx     status = 'delivered' only
 *
 * The campaign LIST therefore showed "Delivered 1,240" while opening that same
 * campaign showed "Delivered 0", because a row only ever reaches the literal
 * 'delivered' status when SES posts a Delivery event — and that never happens
 * unless SES_CONFIG_SET points at a configuration set with an SNS destination.
 *
 * The vocabulary below keeps the two ideas apart instead of conflating them:
 *
 *   attempted  we handed it to the provider (includes the ones that bounced)
 *   accepted   provider took it and we have NOT since heard that it failed
 *   confirmed  the provider explicitly told us it was delivered
 *
 * `accepted` is what a user means by "delivered"; `confirmed` is the stronger
 * claim we can only make when delivery webhooks are wired up.
 */

/** Provider took it and nothing has told us otherwise. */
export const ACCEPTED_STATUSES = ["sent", "delivered", "opened", "clicked"] as const;

/** The provider explicitly confirmed delivery (needs SES/Resend webhooks). */
export const CONFIRMED_STATUSES = ["delivered", "opened", "clicked"] as const;

/** Reached the recipient mail server and failed there, or never went out. */
export const FAILED_STATUSES = ["bounced", "complained", "failed"] as const;

/** Every status a campaign_recipients row can hold. */
export const ALL_STATUSES = [
  "queued", "sent", "delivered", "opened", "clicked",
  "bounced", "complained", "suppressed", "failed",
] as const;

export type RecipientStatus = (typeof ALL_STATUSES)[number];

/** SQL fragment for an IN (...) list — inlined, values are compile-time constants. */
export function sqlIn(list: readonly string[]): string {
  return list.map((s) => `'${s}'`).join(", ");
}

export const ACCEPTED_SQL = sqlIn(ACCEPTED_STATUSES);
export const CONFIRMED_SQL = sqlIn(CONFIRMED_STATUSES);
export const FAILED_SQL = sqlIn(FAILED_STATUSES);

export type CampaignStats = {
  /** Rows on the campaign, whatever their state. */
  recipients: number;
  /** Not sent yet. */
  queued: number;
  /** Skipped before sending because the address is on the suppression list. */
  suppressed: number;
  /** attempted = accepted + bounced + complained + failed. The denominator for every rate. */
  attempted: number;
  /** Went out and has not failed since. This is the "Delivered" users mean. */
  accepted: number;
  /** Subset of `accepted` the provider explicitly confirmed as delivered. */
  confirmed: number;
  /** Accepted, but no delivery confirmation yet (webhook pending or not wired). */
  in_flight: number;
  bounced: number;
  complained: number;
  /** Never left the building — provider rejected the call (bad creds, throttle). */
  failed: number;
  /** Distinct recipients with at least one open / click. */
  opened_unique: number;
  clicked_unique: number;
  /** Raw event counts, including repeats by the same recipient. */
  opens_total: number;
  clicks_total: number;
  open_rate: number;
  click_rate: number;
  bounce_rate: number;
  complaint_rate: number;
  /**
   * True when mail went out but the provider has never confirmed a single
   * delivery and has never reported a bounce — i.e. the feedback loop is not
   * reaching us. The UI uses it to say so rather than showing silent zeroes.
   */
  delivery_feedback_missing: boolean;
};

export function emptyStats(): CampaignStats {
  return {
    recipients: 0, queued: 0, suppressed: 0,
    attempted: 0, accepted: 0, confirmed: 0, in_flight: 0,
    bounced: 0, complained: 0, failed: 0,
    opened_unique: 0, clicked_unique: 0, opens_total: 0, clicks_total: 0,
    open_rate: 0, click_rate: 0, bounce_rate: 0, complaint_rate: 0,
    delivery_feedback_missing: false,
  };
}

/** One recipient row, as little of it as the maths needs. */
export type StatsRow = {
  status?: string | null;
  opens_count?: number | null;
  clicks_count?: number | null;
  opened_at?: string | Date | null;
  clicked_at?: string | Date | null;
};

/** Fold one row into an accumulator. Call `finalizeStats` when the loop ends. */
export function addRow(acc: CampaignStats, r: StatsRow): CampaignStats {
  const status = String(r.status || "");
  acc.recipients++;

  if (status === "queued") acc.queued++;
  else if (status === "suppressed") acc.suppressed++;
  else if (status === "bounced") acc.bounced++;
  else if (status === "complained") acc.complained++;
  else if (status === "failed") acc.failed++;

  if ((ACCEPTED_STATUSES as readonly string[]).includes(status)) {
    acc.accepted++;
    if ((CONFIRMED_STATUSES as readonly string[]).includes(status)) acc.confirmed++;
    else acc.in_flight++;
  }

  // A recipient counts as "opened" if we ever recorded an open, even once the
  // row has moved on to 'clicked' — status is a single latest-state field, so
  // counting opens off status alone loses every recipient who then clicked.
  if (r.opened_at || Number(r.opens_count || 0) > 0) acc.opened_unique++;
  if (r.clicked_at || Number(r.clicks_count || 0) > 0) acc.clicked_unique++;

  acc.opens_total += Number(r.opens_count || 0);
  acc.clicks_total += Number(r.clicks_count || 0);
  return acc;
}

/** Derive `attempted`, the rates, and the feedback-loop flag. */
export function finalizeStats(acc: CampaignStats): CampaignStats {
  acc.attempted = acc.accepted + acc.bounced + acc.complained + acc.failed;
  const d = acc.attempted;
  acc.open_rate = d > 0 ? round1((acc.opened_unique / d) * 100) : 0;
  acc.click_rate = d > 0 ? round1((acc.clicked_unique / d) * 100) : 0;
  // Bounces / sends and complaints / sends are the two ratios the SES console
  // reports separately. Folding complaints into the bounce rate made this read
  // higher than SES for the same campaign.
  acc.bounce_rate = d > 0 ? round1((acc.bounced / d) * 100) : 0;
  acc.complaint_rate = d > 0 ? round1((acc.complained / d) * 100) : 0;
  acc.delivery_feedback_missing =
    acc.accepted > 0 && acc.confirmed === 0 && acc.bounced === 0 && acc.complained === 0;
  return acc;
}

/** Aggregate a list of recipient rows in one pass. */
export function statsFromRows(rows: StatsRow[]): CampaignStats {
  const acc = emptyStats();
  for (const r of rows) addRow(acc, r);
  return finalizeStats(acc);
}

/**
 * Aggregate from a `GROUP BY status` result plus the open/click roll-ups.
 * Used by the routes that count in SQL instead of pulling every row.
 */
export function statsFromCounts(
  counts: Record<string, number>,
  extra: {
    opened_unique?: number;
    clicked_unique?: number;
    opens_total?: number;
    clicks_total?: number;
  } = {}
): CampaignStats {
  const acc = emptyStats();
  const n = (k: string) => Number(counts[k] || 0);
  acc.queued = n("queued");
  acc.suppressed = n("suppressed");
  acc.bounced = n("bounced");
  acc.complained = n("complained");
  acc.failed = n("failed");
  acc.confirmed = n("delivered") + n("opened") + n("clicked");
  acc.in_flight = n("sent");
  acc.accepted = acc.confirmed + acc.in_flight;
  acc.recipients = Object.values(counts).reduce((a, b) => a + Number(b || 0), 0);
  acc.opened_unique = Number(extra.opened_unique || 0);
  acc.clicked_unique = Number(extra.clicked_unique || 0);
  acc.opens_total = Number(extra.opens_total || 0);
  acc.clicks_total = Number(extra.clicks_total || 0);
  return finalizeStats(acc);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
