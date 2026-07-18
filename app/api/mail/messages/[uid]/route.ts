import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { resolveMailAccount, toImapConfig } from "@/lib/mailAccount";
import { getMessage, setMessageSeen } from "@/lib/imap";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/mail/messages/[uid] — full parsed message; marks it read. */
export async function GET(req: Request, { params }: { params: { uid: string } }) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const uid = Number(params.uid);
  if (!Number.isFinite(uid)) {
    return NextResponse.json({ error: "Invalid message id" }, { status: 400 });
  }

  const url = new URL(req.url);
  const row = await resolveMailAccount(session.id, url.searchParams.get("account_id"));
  if (!row) {
    return NextResponse.json({ error: "No mailbox connected" }, { status: 409 });
  }

  const mailbox = url.searchParams.get("mailbox") || "INBOX";

  try {
    const message = await getMessage(toImapConfig(row), uid, mailbox);
    if (!message) return NextResponse.json({ error: "Message not found" }, { status: 404 });
    return NextResponse.json({ message });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to load message" },
      { status: 502 }
    );
  }
}

/**
 * PATCH /api/mail/messages/[uid]  body: { seen: boolean, mailbox?: string }
 * Toggle a message's read/unread state ( \Seen flag ). seen:false = unread.
 */
export async function PATCH(req: Request, { params }: { params: { uid: string } }) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const uid = Number(params.uid);
  if (!Number.isFinite(uid)) {
    return NextResponse.json({ error: "Invalid message id" }, { status: 400 });
  }

  const row = await resolveMailAccount(session.id, new URL(req.url).searchParams.get("account_id"));
  if (!row) return NextResponse.json({ error: "No mailbox connected" }, { status: 409 });

  const body = await req.json().catch(() => ({}));
  if (typeof body.seen !== "boolean") {
    return NextResponse.json({ error: "Body must include { seen: boolean }" }, { status: 400 });
  }
  const mailbox = typeof body.mailbox === "string" && body.mailbox.trim() ? body.mailbox.trim() : "INBOX";

  try {
    await setMessageSeen(toImapConfig(row), uid, body.seen, mailbox);
    return NextResponse.json({ ok: true, seen: body.seen });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to update message" },
      { status: 502 }
    );
  }
}
