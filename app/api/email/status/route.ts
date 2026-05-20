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

  // No SES configured — only auto-verify in local dev.
  // In production this used to lie and mark the identity 'verified' in the DB,
  // which made the UI show a green badge while no real sends went out. Now we
  // surface the actual config gap so it can be fixed.
  if (!isSesConfigured()) {
    if (process.env.NODE_ENV !== "production") {
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
    return NextResponse.json(
      {
        error:
          "SES is not configured. Add AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, and SES_REGION (or AWS_REGION) to the production environment and restart.",
        code: "ses_not_configured",
      },
      { status: 503 }
    );
  }

  // Ask SES for the live verification status, regardless of what the DB cached.
  // The DB is treated as a derived cache here — SES is the source of truth.
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
