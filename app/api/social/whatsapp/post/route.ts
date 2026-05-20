import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { isStaff } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const META_VERSION = process.env.FACEBOOK_API_VERSION || "v19.0";
const PRICE_PER_POST = 1;

/**
 * POST /api/social/whatsapp/post
 * Body: { text: string, image_url?: string }
 *
 * Sends a message to every recipient in WHATSAPP_RECIPIENTS via Meta's
 * Cloud API. Behaviour:
 *   - If WHATSAPP_TEMPLATE_NAME is set → sends as a template (required for
 *     marketing/broadcast outside a 24-hour customer service window).
 *     The template MUST have a single text body parameter that receives
 *     `text`. Image is attached as the header if image_url is given.
 *   - Otherwise → sends as a text message (only works inside a 24-hour
 *     session — i.e. recipient messaged you first within last 24h).
 *
 * One credit per send, regardless of number of recipients (cheap for now;
 * adjust later if needed).
 */
export async function POST(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const text = String(body?.text || "").trim();
  const imageUrl = body?.image_url ? String(body.image_url) : null;
  if (!text && !imageUrl) {
    return NextResponse.json({ error: "Empty post" }, { status: 400 });
  }
  if (imageUrl && !/^https:\/\//i.test(imageUrl)) {
    return NextResponse.json({ error: "image_url must be a public https URL" }, { status: 400 });
  }

  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const recipientsRaw = process.env.WHATSAPP_RECIPIENTS;
  const templateName = process.env.WHATSAPP_TEMPLATE_NAME?.trim() || null;
  const templateLang = process.env.WHATSAPP_TEMPLATE_LANG?.trim() || "en_US";

  if (!token || !phoneId) {
    return NextResponse.json(
      { error: "WhatsApp not configured (WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID missing)" },
      { status: 500 }
    );
  }
  const recipients = (recipientsRaw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (recipients.length === 0) {
    return NextResponse.json(
      { error: "WhatsApp recipient list is empty (set WHATSAPP_RECIPIENTS)" },
      { status: 500 }
    );
  }

  // Credit charge (skip for staff). One credit per broadcast, not per recipient.
  if (!isStaff(session.role)) {
    try {
      await db.query("CALL spend_credit(?, ?, ?, ?, ?)", [
        session.id,
        PRICE_PER_POST,
        "debit",
        `wa_post:${Date.now()}`,
        "Post to WhatsApp",
      ]);
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg.includes("insufficient_credits")) {
        return NextResponse.json(
          { error: "Insufficient credits", code: "insufficient_credits" },
          { status: 402 }
        );
      }
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  const sendUrl = `https://graph.facebook.com/${META_VERSION}/${phoneId}/messages`;
  const results = await Promise.allSettled(
    recipients.map(async (to) => {
      const payload = buildPayload(to, text, imageUrl, templateName, templateLang);
      const r = await fetch(sendUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error?.message || `Send failed (${r.status})`);
      return j?.messages?.[0]?.id ?? null;
    })
  );

  const sent = results.filter((r) => r.status === "fulfilled").length;
  const failed = results
    .map((r, i) => ({ r, to: recipients[i] }))
    .filter(({ r }) => r.status === "rejected")
    .map(({ r, to }) => ({ to, error: (r as PromiseRejectedResult).reason?.message || "Unknown" }));

  if (sent === 0) {
    return NextResponse.json(
      {
        error: "WhatsApp send failed for all recipients",
        details: failed,
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    sent,
    total: recipients.length,
    failed: failed.length ? failed : undefined,
  });
}

function buildPayload(
  to: string,
  text: string,
  imageUrl: string | null,
  templateName: string | null,
  templateLang: string,
): Record<string, any> {
  if (templateName) {
    // Template mode — required for cold broadcast outside 24h session.
    // Assumes a template with one BODY text parameter, and an IMAGE header
    // if image_url is provided.
    const components: any[] = [];
    if (imageUrl) {
      components.push({
        type: "header",
        parameters: [{ type: "image", image: { link: imageUrl } }],
      });
    }
    if (text) {
      components.push({
        type: "body",
        parameters: [{ type: "text", text }],
      });
    }
    return {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: templateLang },
        ...(components.length ? { components } : {}),
      },
    };
  }

  // Session message mode — only valid within a 24h service window.
  if (imageUrl) {
    return {
      messaging_product: "whatsapp",
      to,
      type: "image",
      image: { link: imageUrl, caption: text || undefined },
    };
  }
  return {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  };
}
