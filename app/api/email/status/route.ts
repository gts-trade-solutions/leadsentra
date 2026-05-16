import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { isSesConfigured, getIdentityStatus } from "@/lib/ses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Polls the user's pending sender identity against SES.
 *
 * Body (either form is accepted, the UI sends one or the other):
 *   { identityId: string }   — preferred, lookup by row id
 *   { email: string }        — fallback, lookup by email
 *
 * When SES isn't configured we treat the identity as auto-verified so the
 * dev flow can continue end-to-end.
 */
export async function POST(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const identityId = body?.identityId ? String(body.identityId) : null;
  const email = body?.email ? String(body.email).trim().toLowerCase() : null;

  if (!identityId && !email) {
    return NextResponse.json({ error: "Missing identityId or email" }, { status: 400 });
  }

  const [rows] = identityId
    ? await db.execute(
        `SELECT id, email, status, verified_at FROM email_identities
          WHERE id = ? AND user_id = ? LIMIT 1`,
        [identityId, session.id]
      )
    : await db.execute(
        `SELECT id, email, status, verified_at FROM email_identities
          WHERE user_id = ? AND LOWER(email) = ? LIMIT 1`,
        [session.id, email]
      );
  const row = (rows as any[])[0];
  if (!row) {
    return NextResponse.json({ error: "Identity not found" }, { status: 404 });
  }

  // Already verified — short-circuit
  if (row.status === "verified") {
    return NextResponse.json({ status: "verified", id: row.id, email: row.email });
  }

  // No SES configured → dev-mode auto-verify so the rest of the flow works
  if (!isSesConfigured()) {
    await db.execute(
      `UPDATE email_identities
          SET status = 'verified', verified_at = NOW(), updated_at = NOW()
        WHERE id = ?`,
      [row.id]
    );
    return NextResponse.json({
      status: "verified",
      id: row.id,
      email: row.email,
      dev: true,
    });
  }

  // Ask SES for the live status
  try {
    const sesStatus = await getIdentityStatus(row.email);
    if (sesStatus !== row.status) {
      await db.execute(
        `UPDATE email_identities
            SET status = ?, verified_at = ?, updated_at = NOW()
          WHERE id = ?`,
        [sesStatus, sesStatus === "verified" ? new Date() : null, row.id]
      );
    }
    return NextResponse.json({ status: sesStatus, id: row.id, email: row.email });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "SES error", code: "ses_error" },
      { status: 502 }
    );
  }
}
