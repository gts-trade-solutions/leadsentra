import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { getTemplate, updateTemplate, deleteTemplate } from "@/lib/offerTemplatesRepo";
import { sanitizeBlocks } from "@/lib/offerTemplate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ---- GET: one template with its blocks ----
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tpl = await getTemplate(session.id, params.id);
  if (!tpl) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(tpl);
}

// ---- PUT: update name / blocks / default ----
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const patch: { name?: string; content?: any; is_default?: boolean } = {};
  if (body?.name !== undefined) {
    const name = String(body.name || "").trim().slice(0, 255);
    if (!name) return NextResponse.json({ error: "Template name is required." }, { status: 400 });
    patch.name = name;
  }
  if (body?.content !== undefined) {
    const content = sanitizeBlocks(body.content);
    if (!content.length) return NextResponse.json({ error: "Add at least one content block." }, { status: 400 });
    patch.content = content;
  }
  if (body?.is_default !== undefined) patch.is_default = !!body.is_default;

  try {
    const ok = await updateTemplate(session.id, params.id, patch);
    if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[offer-templates] update failed", e);
    return NextResponse.json({ error: "Could not update template." }, { status: 500 });
  }
}

// ---- DELETE ----
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ok = await deleteTemplate(session.id, params.id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
