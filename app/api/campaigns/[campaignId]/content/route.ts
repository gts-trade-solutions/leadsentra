import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { isStaff } from "@/lib/admin";
import { ensureEmailHtml, htmlToText } from "@/lib/emailTracking";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/campaigns/[campaignId]/content
 *
 * The message as it went out: from, subject, and body. The tracking page shows
 * who received what, but had no way to see WHAT was sent — which is the thing
 * you need in front of you when following up on an open or a reply.
 *
 * Deliberately separate from the recipients route: that one is polled every
 * 15s while a send drains, and the body can be a MEDIUMTEXT of a designed
 * template. No reason to re-ship it on every tick.
 *
 * The body is returned exactly as stored, plus the same `ensureEmailHtml` /
 * `htmlToText` treatment the send path applies — so the preview matches what
 * landed in the inbox, and the text version is the one worth pasting into a
 * manual follow-up.
 */
export async function GET(
  _req: Request,
  { params }: { params: { campaignId: string } }
) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Same ownership rule as the sibling routes: staff see every campaign.
  const staffBypass = isStaff(session.role);

  const [rows] = await db.execute(
    `SELECT id, name, subject, html, from_email, from_name, status,
            recipients_count, low_signal, created_at, updated_at
       FROM campaigns
      WHERE id = ?
        ${staffBypass ? "" : "AND user_id = ?"}
      LIMIT 1`,
    staffBypass ? [params.campaignId] : [params.campaignId, session.id]
  );
  const c = (rows as any[])[0];
  if (!c) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rawHtml: string = c.html ?? "";
  // Plain-text bodies are wrapped into formatted HTML at send time, so render
  // the wrapped version here or the preview would not match the real email.
  const renderedHtml = rawHtml ? ensureEmailHtml(rawHtml) : "";

  return NextResponse.json({
    id: c.id,
    name: c.name,
    subject: c.subject,
    from_email: c.from_email,
    from_name: c.from_name,
    status: c.status,
    recipients_count: Number(c.recipients_count || 0),
    low_signal: !!Number(c.low_signal),
    created_at: c.created_at,
    updated_at: c.updated_at,
    /** Exactly what is stored — what you'd paste back into the composer. */
    html: rawHtml,
    /** What the recipient's mail client rendered. */
    rendered_html: renderedHtml,
    /** Plain-text alternative, handy to paste into a manual follow-up. */
    text: renderedHtml ? htmlToText(renderedHtml) : "",
  });
}
