import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/social/telegram/status
 *
 * Telegram uses a shared bot + channel owned by LeadSentra (configured via
 * env vars), not per-user OAuth. So "connected" just means the env vars are
 * set and the bot token is valid.
 */
export async function GET() {
  const session = await getUser();
  if (!session) return NextResponse.json({ connected: false }, { status: 401 });

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    return NextResponse.json({
      connected: false,
      reason: "Telegram bot not configured. Add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to .env",
    });
  }

  // Verify the token is valid by hitting /getMe. Cheap call (no rate cost).
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getMe`, {
      cache: "no-store",
    });
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok || !j?.ok) {
      return NextResponse.json({
        connected: false,
        reason: j?.description || "Invalid bot token",
      });
    }
    return NextResponse.json({
      connected: true,
      page_name: `@${j.result?.username ?? "telegram_bot"}`,
    });
  } catch (e: any) {
    return NextResponse.json({
      connected: false,
      reason: e?.message || "Failed to reach Telegram API",
    });
  }
}
