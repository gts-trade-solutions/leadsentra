import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { encryptSecret } from "@/lib/secretBox";
import { getMailAccountRow } from "@/lib/mailAccount";
import { testConnection } from "@/lib/imap";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** GET — return the user's mailbox connection (without the password). */
export async function GET() {
  const session = await getUser();
  if (!session) return NextResponse.json({ connected: false }, { status: 401 });

  const row = await getMailAccountRow(session.id);
  if (!row) return NextResponse.json({ connected: false, account: null });

  return NextResponse.json({
    connected: true,
    account: {
      imap_host: row.imap_host,
      imap_port: row.imap_port,
      imap_secure: !!row.imap_secure,
      username: row.username,
      from_name: row.from_name,
    },
  });
}

/**
 * POST — connect (or update) the mailbox. Body:
 *   { imap_host, imap_port, imap_secure, username, password?, from_name? }
 * The connection is tested before saving. On an existing account, an empty
 * password reuses the stored one (so the user can edit other fields safely).
 */
export async function POST(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const host = str(body.imap_host);
  const username = str(body.username);
  const password = typeof body.password === "string" ? body.password : "";
  const fromName = str(body.from_name) || null;
  const port = Number(body.imap_port) || 993;
  const secure = body.imap_secure === false ? false : true;

  if (!host || !username) {
    return NextResponse.json(
      { error: "IMAP host and username are required" },
      { status: 400 }
    );
  }

  const existing = await getMailAccountRow(session.id);

  // Resolve the password to test/store: use the new one if given, else reuse
  // the stored (decrypted) one when editing an existing account.
  let plainPass = password;
  if (!plainPass) {
    if (!existing) {
      return NextResponse.json({ error: "Password is required" }, { status: 400 });
    }
    const { decryptSecret } = await import("@/lib/secretBox");
    plainPass = decryptSecret(existing.password_enc);
  }

  // Verify the credentials before persisting — fail loudly if they're wrong.
  const test = await testConnection({ host, port, secure, user: username, pass: plainPass });
  if (!test.ok) {
    const h = host.toLowerCase();
    let hint = "";
    if (h.includes("gmail") || h.includes("google")) {
      hint =
        " Gmail blocks your normal password over IMAP. Turn on 2-Step Verification, then create an App Password at https://myaccount.google.com/apppasswords and paste that 16-character code here (not your usual password). Also make sure IMAP is enabled in Gmail → Settings → Forwarding and POP/IMAP.";
    } else if (h.includes("outlook") || h.includes("office365") || h.includes("hotmail")) {
      hint =
        " For Outlook / Microsoft 365, enable IMAP on the account and use an App Password if 2-factor auth is on.";
    } else if (h.includes("yahoo")) {
      hint =
        " Yahoo requires an App Password (Account Security → Generate app password), not your normal password.";
    } else if (h.includes("secureserver")) {
      hint =
        " This looks like newer GoDaddy email (powered by Titan). Try host imap.titan.email instead (port 993, SSL), with your full email and webmail password.";
    } else if (h.includes("titan")) {
      hint =
        " Use imap.titan.email (port 993, SSL) with your full email as the username and the same password you use for GoDaddy/Titan webmail.";
    }
    return NextResponse.json(
      { error: `Could not connect: ${test.error || "check host, port, and credentials"}.${hint}` },
      { status: 400 }
    );
  }

  const passwordEnc = encryptSecret(plainPass);
  const id = existing?.id || randomUUID();

  await db.execute(
    `INSERT INTO mail_accounts
       (id, user_id, imap_host, imap_port, imap_secure, username, password_enc, from_name)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       imap_host = VALUES(imap_host),
       imap_port = VALUES(imap_port),
       imap_secure = VALUES(imap_secure),
       username = VALUES(username),
       password_enc = VALUES(password_enc),
       from_name = VALUES(from_name)`,
    [id, session.id, host, port, secure ? 1 : 0, username, passwordEnc, fromName]
  );

  return NextResponse.json({ ok: true });
}

/** DELETE — disconnect the mailbox. */
export async function DELETE() {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await db.execute("DELETE FROM mail_accounts WHERE user_id = ?", [session.id]);
  return NextResponse.json({ ok: true });
}
