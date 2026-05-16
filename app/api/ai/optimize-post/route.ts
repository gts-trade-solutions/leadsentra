import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { isStaff } from "@/lib/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const PRICE_PER_OPTIMIZE = 1; // credits

function lengthHint(length: string): string {
  if (length === "short") return "around 60 words";
  if (length === "long") return "around 220 words";
  return "around 120 words";
}

export async function POST(req: NextRequest) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OpenAI is not configured (set OPENAI_API_KEY)" },
      { status: 500 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const post = String(body?.post || "").trim();
  const hint = String(body?.hint || "").trim();
  const tone = String(body?.tone || "friendly");
  const length = String(body?.length || "medium");
  const platform = String(body?.platform || "linkedin");

  if (!post) return NextResponse.json({ error: "Post text is required" }, { status: 400 });

  // Charge a credit before calling OpenAI (so a successful API call always corresponds to a debit).
  // Staff (admin/moderator) bypass: no charge.
  if (!isStaff(session.role)) {
    try {
      await db.query("CALL spend_credit(?, ?, ?, ?, ?)", [
        session.id,
        PRICE_PER_OPTIMIZE,
        "debit",
        `optimize:${Date.now()}`,
        `Optimize ${platform} post`,
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

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const sys = [
    `You are a senior social-media copywriter for ${platform}.`,
    `Rewrite the user's post in a ${tone} tone, ${lengthHint(length)}.`,
    `Use short paragraphs, plain language, and at most two emojis.`,
    `Do not add hashtags unless the input had them.`,
    `Return ONLY the rewritten post.`,
  ].join(" ");
  const userMsg = [
    `Original post:\n${post}`,
    hint ? `\nGuidance:\n${hint}` : "",
  ].filter(Boolean).join("\n");

  try {
    const resp = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: sys },
        { role: "user", content: userMsg },
      ],
      temperature: 0.7,
    });
    const text = resp.choices[0]?.message?.content?.trim() || "";
    if (!text) {
      return NextResponse.json({ ok: false, error: "Empty AI response" }, { status: 502 });
    }
    return NextResponse.json({ ok: true, text });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "OpenAI request failed" },
      { status: 502 }
    );
  }
}
