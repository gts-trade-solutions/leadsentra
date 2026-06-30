import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { getMailAccountRow, toImapConfig } from "@/lib/mailAccount";
import { listFolders } from "@/lib/imap";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/mail/folders — selectable mailboxes for the connected account. */
export async function GET() {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const row = await getMailAccountRow(session.id);
  if (!row) return NextResponse.json({ error: "No mailbox connected" }, { status: 409 });

  try {
    const folders = await listFolders(toImapConfig(row));
    return NextResponse.json({ folders });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to load folders" },
      { status: 502 }
    );
  }
}
