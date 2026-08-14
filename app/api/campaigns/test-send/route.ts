import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { isEmailShape } from "@/lib/suppressions";
import { sendEmail } from "@/lib/emailProvider";
import { ensureEmailHtml, htmlToText, unsubscribeUrl } from "@/lib/emailTracking";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/campaigns/test-send
 *
 * Sends the campaign being composed to the author (or any address they name)
 * so they can see it in a real inbox before committing to the real send.
 *
 * Deliberately does NOT create a campaign, consume an invoice of credits, or
 * touch campaign_recipients — a test that costs credits or leaves a phantom
 * campaign behind is one nobody uses. Suppression is not consulted either:
 * you're allowed to send yourself a test at an address you've unsubscribed.
 *
 * Body: { to?, subject, html, from_email?, from_name?, low_signal? }
 */
export async function POST(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));

  const subject = String(body.subject || "").trim();
  const rawHtml = String(body.html || "");
  if (!subject) return NextResponse.json({ error: "Add a subject line first." }, { status: 400 });
  if (!rawHtml.trim()) return NextResponse.json({ error: "Write a message first." }, { status: 400 });

  // Default to the signed-in user — the overwhelmingly common case is "send it
  // to me so I can look at it on my phone".
  const to = String(body.to || session.email || "").trim().toLowerCase();
  if (!isEmailShape(to)) {
    return NextResponse.json({ error: "Enter a valid address to send the test to." }, { status: 400 });
  }

  // The From must be one of the caller's verified senders — SES rejects
  // anything else, and a test that fails on the From address teaches nothing
  // about the real send.
  const wanted = String(body.from_email || "").trim().toLowerCase();
  const [rows] = await db.execute(
    `SELECT email, display_name
       FROM email_identities
      WHERE user_id = ? AND status = 'verified'
        ${wanted ? "AND LOWER(email) = ?" : ""}
      ORDER BY is_default DESC, updated_at DESC
      LIMIT 1`,
    wanted ? [session.id, wanted] : [session.id]
  );
  const identity = (rows as any[])[0];
  if (!identity?.email) {
    return NextResponse.json(
      {
        error: wanted
          ? `${wanted} isn't a verified sender. Verify it under Manage senders, or pick another.`
          : "No verified sender address. Add and verify one under Manage senders.",
      },
      { status: 400 }
    );
  }

  const baseUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "";

  // Render the body the same way the real send does, minus the per-recipient
  // tracking: there's no recipient row behind a test, so an open pixel and
  // rewritten click URLs would point at a token that doesn't exist. Links stay
  // as authored, which is what you want to click-test anyway.
  const html = ensureEmailHtml(rawHtml).replace(
    /\{\{\s*unsubscribe_(?:link|url)\s*\}\}/gi,
    baseUrl ? unsubscribeUrl("test-preview", baseUrl) : "#unsubscribe"
  );

  try {
    const res = await sendEmail({
      to,
      subject: `[TEST] ${subject}`,
      html,
      text: htmlToText(html),
      fromEmail: identity.email,
      fromName: String(body.from_name || identity.display_name || "") || undefined,
      lowSignal: body.low_signal === true,
    });
    return NextResponse.json({ ok: true, to, from: identity.email, messageId: res.id });
  } catch (e: any) {
    console.error("[campaigns] test send failed", e);
    return NextResponse.json(
      { error: e?.message || "Could not send the test email." },
      { status: 502 }
    );
  }
}
