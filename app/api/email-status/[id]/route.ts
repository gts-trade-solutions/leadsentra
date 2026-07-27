import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { isStaff } from "@/lib/admin";
import { isEmailShape, loadSuppressionSet, isSuppressed } from "@/lib/suppressions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Statuses whose address may still be corrected.
 *
 * Anything the provider already accepted (sent / delivered / opened / clicked)
 * is history — rewriting the address there would silently re-attribute opens
 * and clicks to a mailbox that never received the mail.  A suppressed, failed,
 * bounced or complained row never reached the recipient, so fixing a typo
 * there is exactly the point.
 */
const EDITABLE_STATUSES = new Set([
  "queued",
  "suppressed",
  "failed",
  "bounced",
  "complained",
]);

/**
 * PATCH /api/email-status/[id]
 *
 * Body: {
 *   email:          string   // the corrected address
 *   updateContact?: boolean  // also write it back to the linked contact (default true)
 *   requeue?:       boolean  // put the row back in the send queue (default false)
 * }
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = String(params.id || "").trim();
  if (!id) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const email = String(body?.email ?? "").trim().toLowerCase();
  const updateContact = body?.updateContact !== false;
  const requeue = body?.requeue === true;

  if (!email) return NextResponse.json({ error: "Email is required" }, { status: 400 });
  if (email.length > 255) {
    return NextResponse.json({ error: "Email is too long (max 255 characters)" }, { status: 400 });
  }
  if (!isEmailShape(email)) {
    return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
  }

  // Load the row with its campaign owner. Staff see every campaign, everyone
  // else only their own — same rule the GET listing uses.
  const [rows] = await db.execute(
    `SELECT cr.id, cr.email, cr.status, cr.contact_id, cr.campaign_id, c.user_id AS owner_id
       FROM campaign_recipients cr
       JOIN campaigns c ON c.id = cr.campaign_id
      WHERE cr.id = ?
      LIMIT 1`,
    [id]
  );
  const row = (rows as any[])[0];
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!isStaff(session.role) && row.owner_id !== session.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const status = String(row.status || "").toLowerCase();
  if (!EDITABLE_STATUSES.has(status)) {
    return NextResponse.json(
      {
        error:
          `This message was already ${status} — its address is part of the delivery ` +
          `record and can't be rewritten. Edit the contact instead.`,
      },
      { status: 409 }
    );
  }

  // Re-queueing is only meaningful if the corrected address is actually
  // sendable. Refuse rather than queue mail that the sender will skip again.
  const suppressionSet = await loadSuppressionSet(row.owner_id);
  const nowSuppressed = isSuppressed(email, suppressionSet);
  if (requeue && nowSuppressed) {
    return NextResponse.json(
      { error: `${email} is on your suppression list — remove or correct it there first.` },
      { status: 409 }
    );
  }

  const sets = ["email = ?"];
  const vals: any[] = [email];
  if (requeue) {
    // Clear the artefacts of the previous attempt so the send route treats
    // this like a fresh recipient (it claims rows on status='queued').
    sets.push(
      "status = 'queued'",
      "message_id = NULL",
      "error_reason = NULL",
      "bounced_at = NULL",
      "complaint_at = NULL",
      "last_event_at = NOW()"
    );
  }
  vals.push(id);
  await db.execute(
    `UPDATE campaign_recipients SET ${sets.join(", ")} WHERE id = ?`,
    vals
  );

  // Write the correction back to the contact so every future campaign uses
  // the fixed address, not just this one row.
  let contactUpdated = false;
  if (updateContact && row.contact_id) {
    const [res] = await db.execute(
      isStaff(session.role)
        ? "UPDATE contacts SET email = ? WHERE id = ?"
        : "UPDATE contacts SET email = ? WHERE id = ? AND (user_id = ? OR user_id IS NULL)",
      isStaff(session.role)
        ? [email, row.contact_id]
        : [email, row.contact_id, session.id]
    );
    contactUpdated = ((res as any)?.affectedRows ?? 0) > 0;
  }

  return NextResponse.json({
    ok: true,
    id,
    email,
    previous_email: row.email,
    status: requeue ? "queued" : status,
    requeued: requeue,
    contact_updated: contactUpdated,
    // Lets the UI warn when the corrected address is itself suppressed and
    // the user didn't ask to re-queue.
    suppressed: nowSuppressed,
  });
}
