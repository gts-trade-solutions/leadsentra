import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/secretBox";
import type { ImapConfig } from "@/lib/imap";

export type MailAccountRow = {
  id: string;
  user_id: string;
  imap_host: string;
  imap_port: number;
  imap_secure: number;
  username: string;
  password_enc: string;
  from_name: string | null;
  label: string | null;
  is_default: number;
};

/** All of a user's connected mailboxes, default first then oldest. */
export async function listMailAccounts(
  userId: string
): Promise<MailAccountRow[]> {
  const [rows] = await db.execute(
    "SELECT * FROM mail_accounts WHERE user_id = ? ORDER BY is_default DESC, created_at ASC",
    [userId]
  );
  return rows as MailAccountRow[];
}

/** One specific mailbox, scoped to the owner (returns null if not theirs). */
export async function getMailAccountById(
  userId: string,
  id: string
): Promise<MailAccountRow | null> {
  const [rows] = await db.execute(
    "SELECT * FROM mail_accounts WHERE user_id = ? AND id = ? LIMIT 1",
    [userId, id]
  );
  return (rows as any[])[0] || null;
}

/**
 * The user's default mailbox: the row flagged is_default, else the oldest.
 * Used by aggregate/analytics scanners and as the fallback when a caller
 * doesn't name a specific account.
 */
export async function getMailAccountRow(
  userId: string
): Promise<MailAccountRow | null> {
  const [rows] = await db.execute(
    "SELECT * FROM mail_accounts WHERE user_id = ? ORDER BY is_default DESC, created_at ASC LIMIT 1",
    [userId]
  );
  return (rows as any[])[0] || null;
}

/**
 * Resolve which mailbox a request targets: the named account (scoped to the
 * user) when an id is given, otherwise the user's default. Every mail data
 * route uses this so the single- and multi-account cases share one path.
 */
export async function resolveMailAccount(
  userId: string,
  accountId?: string | null
): Promise<MailAccountRow | null> {
  const id = (accountId || "").trim();
  return id ? getMailAccountById(userId, id) : getMailAccountRow(userId);
}

/** Build the connect config (decrypting the stored password) from a row. */
export function toImapConfig(row: MailAccountRow): ImapConfig {
  return {
    host: row.imap_host,
    port: Number(row.imap_port),
    secure: !!row.imap_secure,
    user: row.username,
    pass: decryptSecret(row.password_enc),
  };
}
