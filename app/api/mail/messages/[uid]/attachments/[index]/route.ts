import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { getMailAccountRow, toImapConfig } from "@/lib/mailAccount";
import { getAttachment } from "@/lib/imap";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/mail/messages/[uid]/attachments/[index]?mailbox=INBOX
 * Streams a single attachment's bytes as a download.
 */
export async function GET(
  req: Request,
  { params }: { params: { uid: string; index: string } }
) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const uid = Number(params.uid);
  const index = Number(params.index);
  if (!Number.isFinite(uid) || !Number.isFinite(index) || index < 0) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const row = await getMailAccountRow(session.id);
  if (!row) return NextResponse.json({ error: "No mailbox connected" }, { status: 409 });

  const mailbox = new URL(req.url).searchParams.get("mailbox") || "INBOX";

  try {
    const att = await getAttachment(toImapConfig(row), uid, index, mailbox);
    if (!att) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });

    // Sanitise the filename for the Content-Disposition header.
    const safeName = att.filename.replace(/[\r\n"]/g, "_");
    return new NextResponse(new Uint8Array(att.content), {
      status: 200,
      headers: {
        "Content-Type": att.contentType || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${safeName}"`,
        "Content-Length": String(att.content.length),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Failed to download attachment" },
      { status: 502 }
    );
  }
}
