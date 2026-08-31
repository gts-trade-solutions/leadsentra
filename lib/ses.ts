import {
  SESv2Client,
  CreateEmailIdentityCommand,
  GetEmailIdentityCommand,
  DeleteEmailIdentityCommand,
  ListSuppressedDestinationsCommand,
  GetConfigurationSetEventDestinationsCommand,
  type CreateEmailIdentityCommandInput,
} from "@aws-sdk/client-sesv2";

export function isSesConfigured(): boolean {
  return !!(
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY &&
    (process.env.SES_REGION || process.env.AWS_REGION)
  );
}

let _client: SESv2Client | null = null;
export function sesClient(): SESv2Client {
  if (_client) return _client;
  _client = new SESv2Client({
    region: process.env.SES_REGION || process.env.AWS_REGION || "us-east-1",
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
    },
  });
  return _client;
}

/**
 * Asks SES to send a verification email to `address`.  If the identity already
 * exists in SES we silently swallow the AlreadyExistsException so the caller
 * can treat re-verification as idempotent.
 */
export async function createEmailIdentity(address: string): Promise<void> {
  const input: CreateEmailIdentityCommandInput = { EmailIdentity: address };
  try {
    await sesClient().send(new CreateEmailIdentityCommand(input));
  } catch (e: any) {
    const name = e?.name || e?.Code;
    if (name === "AlreadyExistsException") return;
    throw e;
  }
}

export async function deleteEmailIdentity(address: string): Promise<void> {
  try {
    await sesClient().send(new DeleteEmailIdentityCommand({ EmailIdentity: address }));
  } catch (e: any) {
    const name = e?.name || e?.Code;
    if (name === "NotFoundException") return;
    throw e;
  }
}

export type SuppressedDestination = {
  email: string;
  /** "BOUNCE" | "COMPLAINT" — why SES stopped delivering to this address. */
  reason: string;
  /** When SES added it, ISO string. */
  lastUpdate: string | null;
};

/**
 * Every address on the SES ACCOUNT-LEVEL suppression list.
 *
 * SES maintains this itself: a permanent bounce or a complaint puts the
 * address here, and from then on SES refuses to send to it — the send is
 * silently dropped (or comes back as a Reject event) and it still counts
 * against the account's reputation.
 *
 * This is the authoritative record of what has already bounced, and it is
 * available whether or not SNS event publishing was ever configured. That is
 * what makes it the way out of a repeating-bounce loop: the app can read here
 * what it failed to learn from webhooks it never received.
 *
 * Note this list is per AWS ACCOUNT, not per app tenant — every caller must
 * intersect it with its own recipients rather than importing it wholesale.
 */
export async function listSuppressedDestinations(
  opts: { reasons?: ("BOUNCE" | "COMPLAINT")[]; maxPages?: number } = {}
): Promise<SuppressedDestination[]> {
  const client = sesClient();
  const out: SuppressedDestination[] = [];
  let nextToken: string | undefined;
  const maxPages = opts.maxPages ?? 200; // 200 x 1000 = 200k addresses

  for (let page = 0; page < maxPages; page++) {
    const res: any = await client.send(
      new ListSuppressedDestinationsCommand({
        Reasons: opts.reasons,
        PageSize: 1000,
        NextToken: nextToken,
      })
    );
    for (const d of res.SuppressedDestinationSummaries ?? []) {
      if (!d?.EmailAddress) continue;
      out.push({
        email: String(d.EmailAddress).toLowerCase(),
        reason: String(d.Reason || "BOUNCE"),
        lastUpdate: d.LastUpdateTime ? new Date(d.LastUpdateTime).toISOString() : null,
      });
    }
    nextToken = res.NextToken;
    if (!nextToken) break;
  }
  return out;
}

export type ConfigSetHealth = {
  /** SES_CONFIG_SET value, or null when unset. */
  name: string | null;
  /** The set exists in SES and we could read it. */
  exists: boolean;
  /** It has at least one enabled destination carrying bounce/complaint events. */
  publishesBounces: boolean;
  /** Event types the enabled destinations actually carry. */
  eventTypes: string[];
  error?: string;
};

/**
 * Does SES_CONFIG_SET actually publish bounce and complaint events anywhere?
 *
 * A configuration set that exists but has no event destination is the silent
 * failure mode behind a repeating bounce: sends look configured, SES still
 * falls back to emailing the bounce to the sender, and the app never learns.
 */
export async function checkConfigSet(): Promise<ConfigSetHealth> {
  const name = process.env.SES_CONFIG_SET || null;
  if (!name) {
    return { name: null, exists: false, publishesBounces: false, eventTypes: [] };
  }
  try {
    const res: any = await sesClient().send(
      new GetConfigurationSetEventDestinationsCommand({ ConfigurationSetName: name })
    );
    const enabled = (res.EventDestinations ?? []).filter((d: any) => d?.Enabled);
    const eventTypes = Array.from(
      new Set(enabled.flatMap((d: any) => (d.MatchingEventTypes ?? []) as string[]))
    ) as string[];
    return {
      name,
      exists: true,
      publishesBounces: eventTypes.includes("BOUNCE") && eventTypes.includes("COMPLAINT"),
      eventTypes,
    };
  } catch (e: any) {
    return {
      name,
      exists: false,
      publishesBounces: false,
      eventTypes: [],
      error: e?.name === "NotFoundException"
        ? `Configuration set "${name}" does not exist in this SES region.`
        : e?.message || "Could not read the configuration set.",
    };
  }
}

export type SesVerificationStatus = "pending" | "verified" | "failed";

export async function getIdentityStatus(
  address: string
): Promise<SesVerificationStatus> {
  try {
    const res = await sesClient().send(
      new GetEmailIdentityCommand({ EmailIdentity: address })
    );
    if (res.VerifiedForSendingStatus) return "verified";
    return "pending";
  } catch (e: any) {
    const name = e?.name || e?.Code;
    if (name === "NotFoundException") return "failed";
    throw e;
  }
}
