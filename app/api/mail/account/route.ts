import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { encryptSecret, decryptSecret } from "@/lib/secretBox";
import { listMailAccounts, getMailAccountById } from "@/lib/mailAccount";
import { testConnection } from "@/lib/imap";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

// Shape returned to the UI — never includes the (encrypted) password.
function toPublic(row: any) {
  return {
    id: row.id,
    imap_host: row.imap_host,
    imap_port: row.imap_port,
    imap_secure: !!row.imap_secure,
    username: row.username,
    from_name: row.from_name,
    label: row.label ?? null,
    is_default: !!row.is_default,
  };
}

/** GET — list the user's connected mailboxes (passwords omitted). */
export async function GET() {
  const session = await getUser();
  if (!session) return NextResponse.json({ accounts: [] }, { status: 401 });

  const rows = await listMailAccounts(session.id);
  return NextResponse.json({
    accounts: rows.map(toPublic),
    // Back-compat for any caller still reading the old single-account shape.
    connected: rows.length > 0,
  });
}

/**
 * POST — connect a NEW mailbox, or update an existing one by id. Body:
 *   { id?, imap_host, imap_port, imap_secure, username, password?, from_name?,
 *     label?, is_default? }
 * With an `id` it updates that account (empty password reuses the stored one);
 * without an `id` it creates a new account. The connection is tested first.
 */
export async function POST(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const editId = str(body.id);
  const host = str(body.imap_host);
  const username = str(body.username);
  const password = typeof body.password === "string" ? body.password : "";
  const fromName = str(body.from_name) || null;
  const label = str(body.label) || null;
  const makeDefault = body.is_default === true;
  const port = Number(body.imap_port) || 993;
  const secure = body.imap_secure === false ? false : true;

  if (!host || !username) {
    return NextResponse.json(
      { error: "IMAP host and username are required" },
      { status: 400 }
    );
  }

  // When editing, load the existing row (scoped to the user).
  const existing = editId ? await getMailAccountById(session.id, editId) : null;
  if (editId && !existing) {
    return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });
  }

  // Resolve the password to test/store: new one if given, else reuse the
  // stored (decrypted) one when editing.
  let plainPass = password;
  if (!plainPass) {
    if (!existing) {
      return NextResponse.json({ error: "Password is required" }, { status: 400 });
    }
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
  // First account a user connects becomes their default automatically.
  const isFirst = (await listMailAccounts(session.id)).length === 0;
  const isDefault = makeDefault || isFirst || (existing ? !!existing.is_default : false);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    if (existing) {
      await conn.execute(
        `UPDATE mail_accounts
            SET imap_host = ?, imap_port = ?, imap_secure = ?, username = ?,
                password_enc = ?, from_name = ?, label = ?, is_default = ?
          WHERE id = ? AND user_id = ?`,
        [host, port, secure ? 1 : 0, username, passwordEnc, fromName, label, isDefault ? 1 : 0, id, session.id]
      );
    } else {
      await conn.execute(
        `INSERT INTO mail_accounts
           (id, user_id, imap_host, imap_port, imap_secure, username, password_enc, from_name, label, is_default)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, session.id, host, port, secure ? 1 : 0, username, passwordEnc, fromName, label, isDefault ? 1 : 0]
      );
    }
    // Exactly one default per user.
    if (isDefault) {
      await conn.execute(
        "UPDATE mail_accounts SET is_default = 0 WHERE user_id = ? AND id <> ?",
        [session.id, id]
      );
    }
    await conn.commit();
  } catch (e: any) {
    await conn.rollback();
    return NextResponse.json({ error: e?.message || "Failed to save mailbox" }, { status: 500 });
  } finally {
    conn.release();
  }

  return NextResponse.json({ ok: true, id });
}

/** DELETE — disconnect one mailbox by id (?id=...). */
export async function DELETE(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = str(new URL(req.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "Account id is required" }, { status: 400 });

  const existing = await getMailAccountById(session.id, id);
  if (!existing) return NextResponse.json({ error: "Mailbox not found" }, { status: 404 });

  await db.execute("DELETE FROM mail_accounts WHERE id = ? AND user_id = ?", [id, session.id]);

  // If we removed the default, promote the next remaining account.
  if (existing.is_default) {
    const rest = await listMailAccounts(session.id);
    if (rest.length) {
      await db.execute("UPDATE mail_accounts SET is_default = 1 WHERE id = ?", [rest[0].id]);
    }
  }
  return NextResponse.json({ ok: true });
}
