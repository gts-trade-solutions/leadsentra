import { NextResponse } from "next/server";
import OpenAI from "openai";
import { getUser } from "@/lib/auth";
import { isStaff } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

const SYSTEM_PROMPT = `You extract structured data from images of business cards.
Return ONLY a JSON object exactly matching this schema:
{
  "contact": {
    "contact_name": string | null,
    "title": string | null,
    "email": string | null,
    "phone": string | null,
    "linkedin_url": string | null
  },
  "company": {
    "name": string | null,
    "website": string | null,
    "country": string | null,
    "city_regency": string | null,
    "industry": string | null
  }
}

Rules:
- Use null (not empty strings) for unknown fields.
- Normalize emails to lowercase.
- Strip protocols from URLs (no http://, no https://, no www.).
- For phone, preserve the country code if present (e.g. "+91 80 4678 9900").
- Read the company name from the largest/most prominent text or logo line.
- If the image is not a business card or is unreadable, return all-nulls for both sections.
- Do NOT invent data. If unsure, return null.`;

export async function POST(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Staff-only feature.
  if (!isStaff(session.role)) {
    return NextResponse.json({ error: "Card scan is staff-only" }, { status: 403 });
  }
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json(
      { error: "OpenAI is not configured (set OPENAI_API_KEY)" },
      { status: 500 }
    );
  }

  const form = await req.formData().catch(() => null);
  const image = form?.get("image");
  if (!(image instanceof File)) {
    return NextResponse.json({ error: "Missing image file" }, { status: 400 });
  }
  if (image.size > MAX_BYTES) {
    return NextResponse.json({ error: "Image too large (max 8 MB)" }, { status: 413 });
  }
  if (!image.type.startsWith("image/")) {
    return NextResponse.json({ error: "Not an image" }, { status: 400 });
  }

  const buf = Buffer.from(await image.arrayBuffer());
  const dataUrl = `data:${image.type};base64,${buf.toString("base64")}`;

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  try {
    const resp = await openai.chat.completions.create({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract the business card data as JSON." },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
    });
    const text = resp.choices[0]?.message?.content?.trim() || "{}";
    let parsed: any;
    try {
      parsed = JSON.parse(text);
    } catch {
      return NextResponse.json(
        { error: "AI returned non-JSON output", raw: text },
        { status: 502 }
      );
    }
    return NextResponse.json({
      ok: true,
      contact: parsed?.contact ?? {},
      company: parsed?.company ?? {},
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "OpenAI request failed" },
      { status: 502 }
    );
  }
}
