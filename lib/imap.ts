import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

// Thin wrapper over imapflow for the in-app Inbox. Each call opens a fresh
// connection and logs out — simple and stateless, which is fine for the modest
// volumes here (read/reply to campaign replies). All functions throw on
// failure; callers translate that into a clean HTTP error.

export type ImapConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
};

function makeClient(cfg: ImapConfig) {
  return new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
    // Fail fast on bad host/credentials instead of hanging the request.
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
  });
}

export type MsgListItem = {
  uid: number;
  fromName: string;
  fromAddress: string;
  subject: string;
  date: string | null;
  seen: boolean;
};

export type MsgFull = {
  uid: number;
  subject: string;
  fromName: string;
  fromAddress: string;
  to: string;
  date: string | null;
  html: string;
  text: string;
  messageId: string | null;
  attachments: { filename: string; size: number; contentType: string }[];
};

/** Connect + log out. Returns {ok} or {ok:false, error} — never throws. */
export async function testConnection(
  cfg: ImapConfig
): Promise<{ ok: boolean; error?: string; authFailed?: boolean }> {
  const client = makeClient(cfg);
  try {
    await client.connect();
    await client.logout();
    return { ok: true };
  } catch (e: any) {
    try {
      client.close();
    } catch {
      /* ignore */
    }
    // Surface the server's actual reason where possible. imapflow puts the
    // human text in responseText and a code (e.g. AUTHENTICATIONFAILED) in
    // serverResponseCode; "Command failed" alone is unhelpfully generic.
    const authFailed =
      e?.authenticationFailed || e?.serverResponseCode === "AUTHENTICATIONFAILED";
    const detail =
      e?.responseText ||
      e?.response ||
      (authFailed ? "the email or password was rejected" : e?.message) ||
      "connection failed";
    return { ok: false, error: detail, authFailed: !!authFailed } as any;
  }
}

function mapItem(m: any): MsgListItem {
  const env = m.envelope || {};
  const f = (env.from || [])[0] || {};
  const date = env.date || m.internalDate;
  return {
    uid: m.uid,
    fromName: f.name || "",
    fromAddress: f.address || "",
    subject: env.subject || "(no subject)",
    date: date ? new Date(date).toISOString() : null,
    seen: m.flags instanceof Set ? m.flags.has("\\Seen") : false,
  };
}

/** List the most recent messages in a mailbox (optionally filtered by search). */
export async function listMessages(
  cfg: ImapConfig,
  opts: { mailbox?: string; limit?: number; search?: string } = {}
): Promise<MsgListItem[]> {
  const mailbox = opts.mailbox || "INBOX";
  const limit = Math.min(Math.max(opts.limit || 50, 1), 200);
  const search = (opts.search || "").trim();

  const client = makeClient(cfg);
  await client.connect();
  const items: MsgListItem[] = [];
  const lock = await client.getMailboxLock(mailbox);
  try {
    const query = { uid: true, envelope: true, flags: true, internalDate: true };
    if (search) {
      // IMAP server-side search across from / subject / body.
      const uids =
        (await client.search(
          { or: [{ from: search }, { subject: search }, { body: search }] },
          { uid: true }
        )) || [];
      const recent = uids.slice(-limit);
      if (recent.length) {
        for await (const m of client.fetch(recent, query, { uid: true })) {
          items.push(mapItem(m));
        }
      }
    } else {
      const total =
        client.mailbox && typeof client.mailbox === "object"
          ? (client.mailbox as any).exists || 0
          : 0;
      if (total > 0) {
        const from = Math.max(1, total - limit + 1);
        for await (const m of client.fetch(`${from}:*`, query)) {
          items.push(mapItem(m));
        }
      }
    }
  } finally {
    lock.release();
    await client.logout();
  }

  // Newest first.
  items.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return items;
}

/** Fetch one full message (parsed HTML/text + attachment meta) and mark it read. */
export async function getMessage(
  cfg: ImapConfig,
  uid: number,
  mailbox = "INBOX"
): Promise<MsgFull | null> {
  const client = makeClient(cfg);
  await client.connect();
  let result: MsgFull | null = null;
  const lock = await client.getMailboxLock(mailbox);
  try {
    const msg = await client.fetchOne(
      String(uid),
      { source: true, envelope: true, flags: true },
      { uid: true }
    );
    if (msg && (msg as any).source) {
      const parsed = await simpleParser((msg as any).source);
      const fromVal = (parsed.from as any)?.value?.[0] || {};
      result = {
        uid,
        subject: parsed.subject || (msg as any).envelope?.subject || "(no subject)",
        fromName: fromVal.name || "",
        fromAddress: fromVal.address || "",
        to: (parsed.to as any)?.text || "",
        date: parsed.date ? parsed.date.toISOString() : null,
        html: (parsed.html as string) || parsed.textAsHtml || "",
        text: parsed.text || "",
        messageId: parsed.messageId || (msg as any).envelope?.messageId || null,
        attachments: (parsed.attachments || []).map((a: any) => ({
          filename: a.filename || "attachment",
          size: a.size || 0,
          contentType: a.contentType || "",
        })),
      };
      // Best-effort: mark the message as read once opened.
      try {
        await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
      } catch {
        /* non-fatal */
      }
    }
  } finally {
    lock.release();
    await client.logout();
  }
  return result;
}

/** Mark a message read (seen=true) or unread (seen=false) by toggling \Seen. */
export async function setMessageSeen(
  cfg: ImapConfig,
  uid: number,
  seen: boolean,
  mailbox = "INBOX"
): Promise<boolean> {
  const client = makeClient(cfg);
  await client.connect();
  const lock = await client.getMailboxLock(mailbox);
  try {
    if (seen) {
      await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
    } else {
      await client.messageFlagsRemove(String(uid), ["\\Seen"], { uid: true });
    }
    return true;
  } finally {
    lock.release();
    await client.logout();
  }
}

export type ReplyTarget = {
  fromAddress: string;
  fromName: string;
  subject: string;
  messageId: string | null;
  references: string; // existing References chain (space-separated), may be ""
};

/**
 * Fetch what we need to compose a *threaded* reply: the sender, subject, the
 * original Message-ID (becomes In-Reply-To) and its References chain (so the
 * reply slots into the same conversation in the recipient's mail client).
 */
export async function getReplyTarget(
  cfg: ImapConfig,
  uid: number,
  mailbox = "INBOX"
): Promise<ReplyTarget | null> {
  const client = makeClient(cfg);
  await client.connect();
  let res: ReplyTarget | null = null;
  const lock = await client.getMailboxLock(mailbox);
  try {
    const msg = await client.fetchOne(
      String(uid),
      { source: true, envelope: true },
      { uid: true }
    );
    const env = (msg as any)?.envelope || {};
    const f = (env.from || [])[0] || {};
    let fromAddress = f.address || "";
    let fromName = f.name || "";
    let subject = env.subject || "";
    let messageId: string | null = env.messageId || null;
    let references = "";

    if (msg && (msg as any).source) {
      const parsed = await simpleParser((msg as any).source);
      messageId = parsed.messageId || messageId;
      if (Array.isArray(parsed.references)) references = parsed.references.join(" ");
      else if (typeof parsed.references === "string") references = parsed.references;
      if (!fromAddress) {
        const fv = (parsed.from as any)?.value?.[0] || {};
        fromAddress = fv.address || "";
        fromName = fv.name || "";
      }
      if (!subject) subject = parsed.subject || "";
    }

    if (fromAddress || messageId) {
      res = { fromAddress, fromName, subject, messageId, references };
    }
  } finally {
    lock.release();
    await client.logout();
  }
  return res;
}

/** List selectable mailboxes/folders for the connected account. */
export async function listFolders(
  cfg: ImapConfig
): Promise<{ path: string; name: string; specialUse: string | null }[]> {
  const client = makeClient(cfg);
  await client.connect();
  try {
    const list = await client.list();
    return (list || [])
      .filter((b: any) => !(b.flags instanceof Set && b.flags.has("\\Noselect")))
      .map((b: any) => ({
        path: b.path,
        name: b.name || b.path,
        specialUse: b.specialUse || null,
      }));
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
  }
}

/** Download a single attachment's bytes from a message. */
export async function getAttachment(
  cfg: ImapConfig,
  uid: number,
  index: number,
  mailbox = "INBOX"
): Promise<{ filename: string; contentType: string; content: Buffer } | null> {
  const client = makeClient(cfg);
  await client.connect();
  let res: { filename: string; contentType: string; content: Buffer } | null = null;
  const lock = await client.getMailboxLock(mailbox);
  try {
    const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
    if (msg && (msg as any).source) {
      const parsed = await simpleParser((msg as any).source);
      const att = (parsed.attachments || [])[index];
      if (att) {
        res = {
          filename: att.filename || `attachment-${index + 1}`,
          contentType: att.contentType || "application/octet-stream",
          content: att.content as Buffer,
        };
      }
    }
  } finally {
    lock.release();
    await client.logout();
  }
  return res;
}

/** Find the account's "Sent" mailbox path (special-use first, then by name). */
async function findSentPath(client: ImapFlow): Promise<string | null> {
  const list = await client.list();
  const bySpecial = (list || []).find((b: any) => b.specialUse === "\\Sent");
  if (bySpecial) return bySpecial.path;
  const byName = (list || []).find((b: any) =>
    /^(sent|sent items|sent mail|sent messages)$/i.test(b.name || "") ||
    /(^|[./])sent($|[./])/i.test(b.path || "")
  );
  return byName ? byName.path : null;
}

/** Append a raw RFC822 message to the Sent folder. Best-effort. */
export async function appendToSent(cfg: ImapConfig, raw: Buffer): Promise<boolean> {
  const client = makeClient(cfg);
  await client.connect();
  try {
    const sent = await findSentPath(client);
    if (!sent) return false;
    await client.append(sent, raw, ["\\Seen"]);
    return true;
  } catch {
    return false;
  } finally {
    try {
      await client.logout();
    } catch {
      /* ignore */
    }
  }
}

/** RFC 2047 encoded-word for a non-ASCII header value (e.g. a display name). */
function mimeWord(s: string): string {
  if (/^[\x20-\x7E]*$/.test(s)) return s;
  return `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
}

/** Split a base64 string into 76-char lines (RFC 2045). */
function chunk64(b64: string): string {
  return (b64.match(/.{1,76}/g) || []).join("\r\n");
}

/**
 * Build a raw RFC822 message for appending a sent reply to the Sent folder.
 * multipart/alternative (text + html), base64 bodies, with threading headers.
 */
export function buildRfc822(opts: {
  fromEmail: string;
  fromName?: string;
  to: string;
  subject: string;
  html: string;
  text?: string;
  inReplyTo?: string;
  references?: string;
}): Buffer {
  const fromHeader = opts.fromName
    ? `${mimeWord(opts.fromName)} <${opts.fromEmail}>`
    : opts.fromEmail;
  const domain = (opts.fromEmail.split("@")[1] || "localhost").toLowerCase();
  const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2)}@${domain}>`;
  const boundary = `bnd_${Math.random().toString(36).slice(2)}`;

  const lines: string[] = [];
  lines.push(`From: ${fromHeader}`);
  lines.push(`To: ${opts.to}`);
  lines.push(`Subject: ${mimeWord(opts.subject)}`);
  lines.push(`Message-ID: ${messageId}`);
  lines.push(`Date: ${new Date().toUTCString()}`);
  if (opts.inReplyTo) lines.push(`In-Reply-To: ${opts.inReplyTo}`);
  if (opts.references) lines.push(`References: ${opts.references}`);
  lines.push("MIME-Version: 1.0");
  lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
  lines.push("");
  if (opts.text) {
    lines.push(`--${boundary}`);
    lines.push("Content-Type: text/plain; charset=utf-8");
    lines.push("Content-Transfer-Encoding: base64");
    lines.push("");
    lines.push(chunk64(Buffer.from(opts.text, "utf8").toString("base64")));
    lines.push("");
  }
  lines.push(`--${boundary}`);
  lines.push("Content-Type: text/html; charset=utf-8");
  lines.push("Content-Transfer-Encoding: base64");
  lines.push("");
  lines.push(chunk64(Buffer.from(opts.html, "utf8").toString("base64")));
  lines.push("");
  lines.push(`--${boundary}--`);

  return Buffer.from(lines.join("\r\n"), "utf8");
}
