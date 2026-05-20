import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const META_VERSION = process.env.FACEBOOK_API_VERSION || "v19.0";

/**
 * GET /api/social/whatsapp/status
 *
 * WhatsApp uses Meta's Cloud API. "Connected" means env vars are set and
 * the access token can read the configured phone number. No per-user OAuth.
 *
 * Required env vars (set when you're ready to enable):
 *   WHATSAPP_ACCESS_TOKEN     - permanent system-user token from Meta Business
 *   WHATSAPP_PHONE_NUMBER_ID  - the numeric ID of the WhatsApp number
 *   WHATSAPP_RECIPIENTS       - comma-separated phone numbers (E.164, e.g. +918072098352)
 *   WHATSAPP_TEMPLATE_NAME    - optional, name of a pre-approved template
 *   WHATSAPP_TEMPLATE_LANG    - optional, defaults to en_US
 */
export async function GET() {
  const session = await getUser();
  if (!session) return NextResponse.json({ connected: false }, { status: 401 });

  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const recipientsRaw = process.env.WHATSAPP_RECIPIENTS;

  if (!token || !phoneId) {
    return NextResponse.json({
      connected: false,
      reason: "WhatsApp not configured. Add WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID to .env",
    });
  }
  if (!recipientsRaw?.trim()) {
    return NextResponse.json({
      connected: false,
      reason: "WhatsApp recipient list is empty. Add WHATSAPP_RECIPIENTS (comma-separated phone numbers) to .env",
    });
  }

  // Verify the token + phone number by reading the phone number entity.
  // Failure here usually means the token expired or doesn't have the
  // whatsapp_business_messaging permission.
  try {
    const r = await fetch(
      `https://graph.facebook.com/${META_VERSION}/${phoneId}?fields=verified_name,display_phone_number`,
      {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      }
    );
    const j: any = await r.json().catch(() => ({}));
    if (!r.ok) {
      return NextResponse.json({
        connected: false,
        reason: j?.error?.message || "Invalid WhatsApp access token or phone number ID",
      });
    }
    return NextResponse.json({
      connected: true,
      page_name: j?.verified_name || j?.display_phone_number || "WhatsApp Business",
      recipients_count: recipientsRaw.split(",").map((s) => s.trim()).filter(Boolean).length,
    });
  } catch (e: any) {
    return NextResponse.json({
      connected: false,
      reason: e?.message || "Failed to reach Meta API",
    });
  }
}
