import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

export async function POST(req: NextRequest) {
  await requireUser();
  const body = await req.json();
  const { title = "", context = "", tone = "professional", length = 120 } = body || {};
  const sys = `You are a social media copywriter. Keep output around ${length} words in ${tone} tone.`;
  const user = [title && `Title: ${title}`, context && `Context:\n${context}`].filter(Boolean).join("\n");

  const resp = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: "system", content: sys }, { role: "user", content: user }],
    temperature: 0.7,
  });

  const text = resp.choices[0]?.message?.content?.trim() || "";
  if (!text) return NextResponse.json({ ok: false, error: "Empty AI response" }, { status: 400 });
  return NextResponse.json({ ok: true, text });
}
