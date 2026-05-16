import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import {
  SuppressionType,
  isDomainShape,
  isEmailShape,
  normalizeDomain,
} from "@/lib/suppressions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_SOURCES = new Set([
  "manual",
  "bounce",
  "complaint",
  "unsubscribe",
  "import",
]);

/**
 * PATCH /api/suppressions/[id]
 * Body (any subset): { value, type, reason, source }
 *
 * The value is re-validated for the (possibly new) type.  The row is
 * scoped to the caller's user_id so users can only edit their own entries.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  // Load current row so partial updates can validate against the resulting state.
  const [rows] = await db.execute(
    "SELECT id, type, value, reason, source FROM suppressions WHERE id = ? AND user_id = ? LIMIT 1",
    [id, session.id]
  );
  const current = (rows as any[])[0];
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const sets: string[] = [];
  const vals: any[] = [];

  // Resolve the type-after-update first so value validation uses the right rules.
  let nextType: SuppressionType = current.type;
  if (body.type !== undefined) {
    const t = String(body.type).toLowerCase().trim();
    if (t !== "email" && t !== "domain") {
      return NextResponse.json({ error: "type must be 'email' or 'domain'" }, { status: 400 });
    }
    nextType = t as SuppressionType;
    sets.push("type = ?");
    vals.push(nextType);
  }

  if (body.value !== undefined) {
    let v = String(body.value).trim().toLowerCase();
    if (!v) return NextResponse.json({ error: "value cannot be empty" }, { status: 400 });
    if (nextType === "domain") v = normalizeDomain(v);
    if (nextType === "email" && !isEmailShape(v)) {
      return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
    }
    if (nextType === "domain" && !isDomainShape(v)) {
      return NextResponse.json({ error: "Invalid domain format" }, { status: 400 });
    }
    sets.push("value = ?");
    vals.push(v);
  }

  if (body.reason !== undefined) {
    const reason = body.reason === null
      ? null
      : String(body.reason).trim().slice(0, 255) || null;
    sets.push("reason = ?");
    vals.push(reason);
  }

  if (body.source !== undefined) {
    const src = String(body.source).toLowerCase().trim();
    if (!ALLOWED_SOURCES.has(src)) {
      return NextResponse.json({ error: "Invalid source" }, { status: 400 });
    }
    sets.push("source = ?");
    vals.push(src);
  }

  if (body.corrected !== undefined) {
    // Truthy → 1, falsy → 0.  Setting corrected=1 means "this address was
    // wrongly suppressed (e.g. mailbox is actually valid)"; the row stays
    // for audit but no longer blocks delivery.
    const flag = body.corrected ? 1 : 0;
    sets.push("corrected = ?", "corrected_at = ?");
    vals.push(flag, flag ? new Date() : null);
  }

  if (!sets.length) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  vals.push(id, session.id);
  try {
    await db.execute(
      `UPDATE suppressions SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`,
      vals
    );
  } catch (e: any) {
    // Unique key collision (user_id, type, value) — another entry already exists.
    if (e?.code === "ER_DUP_ENTRY") {
      return NextResponse.json(
        { error: "Another suppression with the same value already exists" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: e?.message || "Update failed" }, { status: 500 });
  }

  const [updated] = await db.execute(
    "SELECT id, type, value, reason, source, corrected, corrected_at, created_at FROM suppressions WHERE id = ? LIMIT 1",
    [id]
  );
  return NextResponse.json({ row: (updated as any[])[0] });
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const [result] = await db.execute(
    "DELETE FROM suppressions WHERE id = ? AND user_id = ?",
    [id, session.id]
  );
  const affected = (result as any)?.affectedRows ?? 0;
  if (affected === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
