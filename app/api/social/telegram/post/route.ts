import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { isStaff } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PRICE_PER_POST = 1;

/**
 * POST /api/social/telegram/post
 * Body: { text: string, image_url?: string }
 *
 * Posts a message to the configured Telegram channel via the bot:
 *   - text only  → sendMessage
 *   - with image → sendPhoto (image fetched directly by Telegram from the URL)
 *
 * Uses shared TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID env vars, NOT per-user
 * OAuth like LinkedIn/Facebook.
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

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return NextResponse.json(
      { error: "Telegram bot not configured (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID missing)" },
      { status: 500 }
    );
  }

  // Credit charge (skip for staff)
  if (!isStaff(session.role)) {
    try {
      await db.query("CALL spend_credit(?, ?, ?, ?, ?)", [
        session.id,
        PRICE_PER_POST,
        "debit",
        `tg_post:${Date.now()}`,
        "Post to Telegram",
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

  // Telegram caption limit: 1024 chars (sendPhoto) vs 4096 chars (sendMessage).
  // Truncate to be safe rather than failing.
  const safeText = imageUrl ? text.slice(0, 1024) : text.slice(0, 4096);

  const endpoint = imageUrl
    ? `https://api.telegram.org/bot${token}/sendPhoto`
    : `https://api.telegram.org/bot${token}/sendMessage`;
  const payload: Record<string, string> = imageUrl
    ? { chat_id: chatId, photo: imageUrl, caption: safeText, parse_mode: "HTML" }
    : { chat_id: chatId, text: safeText, parse_mode: "HTML" };

  const r = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok || !j?.ok) {
    return NextResponse.json(
      { error: j?.description || "Telegram post failed" },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    id: j?.result?.message_id ?? null,
    chat_id: j?.result?.chat?.id ?? null,
  });
}
