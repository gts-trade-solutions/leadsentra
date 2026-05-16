import {
  SESv2Client,
  CreateEmailIdentityCommand,
  GetEmailIdentityCommand,
  DeleteEmailIdentityCommand,
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
