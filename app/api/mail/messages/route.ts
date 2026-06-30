import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { getMailAccountRow, toImapConfig } from "@/lib/mailAccount";
import { listMessages } from "@/lib/imap";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/mail/messages?limit=50&search=...
 * Lists the most recent INBOX messages for the connected mailbox.
 */
export async function GET(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const row = await getMailAccountRow(session.id);
  if (!row) {
    return NextResponse.json({ error: "No mailbox connected", connected: false }, { status: 409 });
  }

  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit") || 50);
  const search = url.searchParams.get("search") || "";
  const mailbox = url.searchParams.get("mailbox") || "INBOX";

  try {
    const messages = await listMessages(toImapConfig(row), { mailbox, limit, search });
    return NextResponse.json({ messages });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to load messages" },
      { status: 502 }
    );
  }
}
