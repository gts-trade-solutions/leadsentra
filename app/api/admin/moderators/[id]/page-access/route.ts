import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/admin";
import {
  PORTAL_PAGES,
  getModeratorPages,
  setModeratorPages,
  clearModeratorPages,
} from "@/lib/modPageAccess";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function loadModerator(id: string) {
  const [rows] = await db.execute(
    "SELECT id, role FROM users WHERE id = ? LIMIT 1",
    [id]
  );
  return (rows as any[])[0] || null;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const gate = await requireRole("admin");
  if ("response" in gate) return gate.response;

  const target = await loadModerator(params.id);
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const pages = await getModeratorPages(params.id);
  return NextResponse.json({
    user_id: params.id,
    role: target.role,
    pages,                          // null = inherit (allow all)
    all_pages: PORTAL_PAGES,
  });
}

/**
 * PUT body:
 *   { pages: string[] }                  → save explicit allowlist (may be empty)
 *   { pages: null } or { reset: true }   → remove override (allow all again)
 */
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const gate = await requireRole("admin");
  if ("response" in gate) return gate.response;

  const target = await loadModerator(params.id);
  if (!target) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (target.role !== "moderator") {
    return NextResponse.json(
      { error: "Page access can only be set for moderators" },
      { status: 400 }
    );
  }

  const body = await req.json().catch(() => ({}));
  if (body?.reset === true || body?.pages === null) {
    await clearModeratorPages(params.id);
    return NextResponse.json({ ok: true, pages: null });
  }
  if (!Array.isArray(body?.pages)) {
    return NextResponse.json({ error: "pages must be an array" }, { status: 400 });
  }
  await setModeratorPages(params.id, body.pages);
  const pages = await getModeratorPages(params.id);
  return NextResponse.json({ ok: true, pages });
}
