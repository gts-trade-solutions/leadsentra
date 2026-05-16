import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import {
  isSesConfigured,
  createEmailIdentity,
  deleteEmailIdentity,
} from "@/lib/ses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Total sender-email changes allowed per account.  Hard server-side cap —
// the client also enforces this for UX, but the server is the source of truth.
// After this many changes, the user must contact support to reset.
const CHANGE_LIMIT = 2;

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export async function POST(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const email = String(body?.email || "").trim().toLowerCase();

  if (!email || !isEmail(email)) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
  }

  // Find any existing identity for this user (one active row per user).
  const [rows] = await db.execute(
    `SELECT id, email, status, verified_at, changes_used, changes_limit
       FROM email_identities
      WHERE user_id = ?
      ORDER BY updated_at DESC
      LIMIT 1`,
    [session.id]
  );
  const existing = (rows as any[])[0] || null;

  // Re-verifying the same email? Just refresh the SES identity and bump status to pending.
  if (existing && String(existing.email).toLowerCase() === email) {
    try {
      if (isSesConfigured()) {
        await createEmailIdentity(email);
      }
    } catch (e: any) {
      return NextResponse.json(
        { error: e?.message || "SES error", code: "ses_error" },
        { status: 502 }
      );
    }

    const newStatus = isSesConfigured() ? "pending" : "verified";
    await db.execute(
      `UPDATE email_identities
          SET status = ?, verified_at = ?, updated_at = NOW()
        WHERE id = ?`,
      [newStatus, newStatus === "verified" ? new Date() : null, existing.id]
    );

    return NextResponse.json({
      mode: "auth",
      id: existing.id,
      email,
      status: newStatus,
      changes_used: Number(existing.changes_used || 0),
      changes_limit: CHANGE_LIMIT,
      dev: !isSesConfigured(),
    });
  }

  // Changing to a new sender — enforce the change limit
  if (existing) {
    const used = Number(existing.changes_used || 0);
    if (used >= CHANGE_LIMIT) {
      return NextResponse.json(
        {
          error: `Sender change limit reached (${CHANGE_LIMIT}/${CHANGE_LIMIT}). Contact support to reset.`,
          code: "change_limit_reached",
        },
        { status: 403 }
      );
    }

    // Best-effort: drop the old identity from SES so we don't leak it.
    if (isSesConfigured()) {
      try { await deleteEmailIdentity(existing.email); } catch { /* ignore */ }
    }

    try {
      if (isSesConfigured()) {
        await createEmailIdentity(email);
      }
    } catch (e: any) {
      return NextResponse.json(
        { error: e?.message || "SES error", code: "ses_error" },
        { status: 502 }
      );
    }

    const newStatus = isSesConfigured() ? "pending" : "verified";
    await db.execute(
      `UPDATE email_identities
          SET email = ?, status = ?, verified_at = ?,
              changes_used = changes_used + 1, updated_at = NOW()
        WHERE id = ?`,
      [email, newStatus, newStatus === "verified" ? new Date() : null, existing.id]
    );

    return NextResponse.json({
      mode: "auth",
      id: existing.id,
      email,
      status: newStatus,
      changes_used: used + 1,
      changes_limit: CHANGE_LIMIT,
      dev: !isSesConfigured(),
    });
  }

  // First-time identity for this user
  try {
    if (isSesConfigured()) {
      await createEmailIdentity(email);
    }
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "SES error", code: "ses_error" },
      { status: 502 }
    );
  }

  const id = randomUUID();
  const newStatus = isSesConfigured() ? "pending" : "verified";
  await db.execute(
    `INSERT INTO email_identities
       (id, user_id, email, status, verified_at, changes_used, changes_limit, provider)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    [
      id,
      session.id,
      email,
      newStatus,
      newStatus === "verified" ? new Date() : null,
      CHANGE_LIMIT,
      isSesConfigured() ? "ses" : "dev",
    ]
  );

  return NextResponse.json({
    mode: "auth",
    id,
    email,
    status: newStatus,
    changes_used: 0,
    changes_limit: CHANGE_LIMIT,
    dev: !isSesConfigured(),
  });
}
