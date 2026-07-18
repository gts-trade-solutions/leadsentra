import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { resolveMailAccount, toImapConfig } from "@/lib/mailAccount";
import { listFolders } from "@/lib/imap";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/mail/folders?account_id=... — selectable mailboxes for one account. */
export async function GET(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const accountId = new URL(req.url).searchParams.get("account_id");
  const row = await resolveMailAccount(session.id, accountId);
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
