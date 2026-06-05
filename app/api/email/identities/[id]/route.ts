import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { isSesConfigured, deleteEmailIdentity } from "@/lib/ses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * DELETE /api/email/identities/[id]
 *   Removes one of the caller's sender identities and (best-effort) deletes
 *   it from SES too.  If the removed identity was the default, we promote
 *   another verified identity to default so the user always has one selected.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = params.id;
  const [rows] = await db.execute(
    "SELECT id, email, is_default FROM email_identities WHERE id = ? AND user_id = ? LIMIT 1",
    [id, session.id]
  );
  const row = (rows as any[])[0];
  if (!row) return NextResponse.json({ error: "Identity not found" }, { status: 404 });

  // Best-effort SES cleanup — never block the local delete if SES errors.
  if (isSesConfigured()) {
    try { await deleteEmailIdentity(row.email); } catch { /* ignore */ }
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      "DELETE FROM email_identities WHERE id = ? AND user_id = ?",
      [id, session.id]
    );

    // If we just removed the default, promote the next verified identity
    // (most recently updated) so the dropdown still has a default selected.
    if (Number(row.is_default) === 1) {
      const [remaining] = await conn.execute(
        `SELECT id FROM email_identities
          WHERE user_id = ? AND status = 'verified'
          ORDER BY updated_at DESC LIMIT 1`,
        [session.id]
      );
      const next = (remaining as any[])[0];
      if (next) {
        await conn.execute(
          "UPDATE email_identities SET is_default = 1, updated_at = NOW() WHERE id = ?",
          [next.id]
        );
      }
    }
    await conn.commit();
  } catch (e: any) {
    await conn.rollback();
    return NextResponse.json({ error: e?.message || "Delete failed" }, { status: 500 });
  } finally {
    conn.release();
  }

  return NextResponse.json({ ok: true });
}
