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
};

/** Load the current user's saved IMAP account, or null if none configured. */
export async function getMailAccountRow(
  userId: string
): Promise<MailAccountRow | null> {
  const [rows] = await db.execute(
    "SELECT * FROM mail_accounts WHERE user_id = ? LIMIT 1",
    [userId]
  );
  return (rows as any[])[0] || null;
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
