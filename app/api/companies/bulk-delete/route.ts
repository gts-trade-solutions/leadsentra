import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { gateDelete, pendingDeleteResponse } from "@/lib/deleteRequests";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/companies/bulk-delete
 * Admin-only. Companies that still have contacts linked to them are SKIPPED
 * (not deleted) — same rule as DELETE /api/companies/[company_id], so we
 * never silently orphan contact rows.
 */
export async function POST(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isAdmin(session.role)) {
    return NextResponse.json({ error: "Forbidden — admin only" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body?.ids)
    ? body.ids.filter((x: any) => typeof x === "string" && x)
    : [];
  if (!ids.length) return NextResponse.json({ error: "Missing ids" }, { status: 400 });
  if (ids.length > 5000) {
    return NextResponse.json({ error: "Too many ids (max 5000)" }, { status: 400 });
  }

  // Bulk delete is admin-only, so this always gates unless a super admin is
  // calling. The whole selection goes on one request — approving it deletes
  // exactly the set that was asked about.
  const gate = await gateDelete(session, {
    resource: "company_bulk",
    label: `${ids.length} ${ids.length === 1 ? "company" : "companies"}`,
    payload: { ids },
  });
  if (!gate.allowed) return pendingDeleteResponse(gate);

  const placeholders = ids.map(() => "?").join(",");
  const [blockedRows] = await db.query(
    `SELECT company_id FROM contacts WHERE company_id IN (${placeholders}) GROUP BY company_id`,
    ids
  );
  const blocked = new Set((blockedRows as any[]).map((r) => r.company_id));
  const deletable = ids.filter((id) => !blocked.has(id));

  if (!deletable.length) {
    return NextResponse.json({
      deleted: 0,
      skipped: ids.length,
      blocked_with_contacts: Array.from(blocked),
    });
  }

  const ph = deletable.map(() => "?").join(",");
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    // Clean up the per-user company-asset unlock receipts so deleting a
    // company doesn't leave dangling unlock rows. Contact-side unlocks
    // are out of scope here because rows that still have contacts are
    // already excluded above.
    await conn.query(
      `DELETE FROM company_assets_unlocks WHERE company_id IN (${ph})`,
      deletable
    ).catch(() => { /* table may not exist on older installs — non-fatal */ });
    await conn.query(`DELETE FROM companies WHERE company_id IN (${ph})`, deletable);
    await conn.commit();
  } catch (e: any) {
    await conn.rollback();
    return NextResponse.json({ error: e?.message || "Delete failed" }, { status: 500 });
  } finally {
    conn.release();
  }

  return NextResponse.json({
    deleted: deletable.length,
    skipped: ids.length - deletable.length,
    blocked_with_contacts: Array.from(blocked),
  });
}
