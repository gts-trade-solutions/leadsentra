import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function POST(req: NextRequest) {
  await requireUser();
  const { imageUrl, context = "" } = await req.json();
  if (!imageUrl) return NextResponse.json({ ok: false, error: "imageUrl required" }, { status: 400 });

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: "Create a short engaging caption (<= 40 words) with 3–6 tasteful hashtags, then an ALT text (<= 20 words)." },
    { role: "user", content: [
      { type: "text", text: `Context: ${context}` },
      { type: "image_url", image_url: { url: imageUrl } },
    ]},
  ];

  const resp = await client.chat.completions.create({ model: MODEL, messages, temperature: 0.6 });
  const out = resp.choices[0]?.message?.content || "";
  return NextResponse.json({ ok: true, caption: out, alt: "" }); // keep simple
}
