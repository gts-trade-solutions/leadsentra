import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { listTemplates, createTemplate } from "@/lib/offerTemplatesRepo";
import { sanitizeBlocks } from "@/lib/offerTemplate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ---- GET: list this user's offer templates (seeds the default on first use) ----
export async function GET() {
  const session = await getUser();
  if (!session) return NextResponse.json({ data: [] }, { status: 401 });
  const templates = await listTemplates(session.id);
  return NextResponse.json({ data: templates });
}

// ---- POST: create a template ----
export async function POST(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const name = String(body?.name || "").trim().slice(0, 255);
  if (!name) return NextResponse.json({ error: "Template name is required." }, { status: 400 });

  const content = sanitizeBlocks(body?.content);
  if (!content.length) return NextResponse.json({ error: "Add at least one content block." }, { status: 400 });

  try {
    const tpl = await createTemplate(session.id, name, content, !!body?.is_default);
    return NextResponse.json(tpl, { status: 201 });
  } catch (e: any) {
    console.error("[offer-templates] create failed", e);
    return NextResponse.json({ error: "Could not create template." }, { status: 500 });
  }
}
