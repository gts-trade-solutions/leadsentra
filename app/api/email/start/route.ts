import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import {
  isSesConfigured,
  createEmailIdentity,
} from "@/lib/ses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Maximum sender identities a single account may verify.  The "Send from"
// dropdown lists these; this caps how many a user can accumulate.
const MAX_IDENTITIES = 10;

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export async function POST(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const email = String(body?.email || "").trim().toLowerCase();
  // Optional friendly From name (e.g. "Race Auto India").  Trimmed + capped to
  // the column width; blank means the recipient just sees the address.
  const displayName = String(body?.name || "").trim().slice(0, 255) || null;

  if (!email || !isEmail(email)) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
  }

  // Re-verifying an email this user already added?  Refresh the SES identity,
  // bump it back to pending, and update the display name if one was provided.
  const [existingRows] = await db.execute(
    `SELECT id, status FROM email_identities
      WHERE user_id = ? AND LOWER(email) = ? LIMIT 1`,
    [session.id, email]
  );
  const existing = (existingRows as any[])[0] || null;

  if (existing) {
    try {
      if (isSesConfigured()) await createEmailIdentity(email);
    } catch (e: any) {
      return NextResponse.json(
        { error: e?.message || "SES error", code: "ses_error" },
        { status: 502 }
      );
    }

    const newStatus = isSesConfigured() ? "pending" : "verified";
    await db.execute(
      `UPDATE email_identities
          SET status = ?,
              verified_at = ?,
              display_name = COALESCE(?, display_name),
              updated_at = NOW()
        WHERE id = ?`,
      [newStatus, newStatus === "verified" ? new Date() : null, displayName, existing.id]
    );

    return NextResponse.json({
      mode: "auth",
      id: existing.id,
      email,
      display_name: displayName,
      status: newStatus,
      dev: !isSesConfigured(),
    });
  }

  // New identity — enforce the per-account cap.
  const [countRows] = await db.execute(
    "SELECT COUNT(*) AS n FROM email_identities WHERE user_id = ?",
    [session.id]
  );
  const total = Number((countRows as any[])[0]?.n || 0);
  if (total >= MAX_IDENTITIES) {
    return NextResponse.json(
      {
        error: `You can verify at most ${MAX_IDENTITIES} senders. Remove one from Manage to add another.`,
        code: "identity_limit_reached",
      },
      { status: 403 }
    );
  }

  try {
    if (isSesConfigured()) await createEmailIdentity(email);
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "SES error", code: "ses_error" },
      { status: 502 }
    );
  }

  const id = randomUUID();
  const newStatus = isSesConfigured() ? "pending" : "verified";
  // First identity for this account becomes the default automatically.
  const isDefault = total === 0 ? 1 : 0;

  await db.execute(
    `INSERT INTO email_identities
       (id, user_id, email, display_name, status, is_default, verified_at, changes_used, changes_limit, provider)
     VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [
      id,
      session.id,
      email,
      displayName,
      newStatus,
      isDefault,
      newStatus === "verified" ? new Date() : null,
      MAX_IDENTITIES,
      isSesConfigured() ? "ses" : "dev",
    ]
  );

  return NextResponse.json({
    mode: "auth",
    id,
    email,
    display_name: displayName,
    status: newStatus,
    is_default: !!isDefault,
    dev: !isSesConfigured(),
  });
}
