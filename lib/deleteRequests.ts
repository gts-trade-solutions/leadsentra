import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { isStaff, isSuperAdmin } from "@/lib/roles";
import { deleteTerm, deleteAliasesTo, VOCAB_COLUMN, VOCAB_KINDS, VOCAB_LABEL, type VocabKind } from "@/lib/vocab";
import { deleteOrder } from "@/lib/orders";
import { deleteTemplate } from "@/lib/offerTemplatesRepo";

/**
 * Delete approvals.
 *
 * An admin deleting shared business data no longer deletes it — the request is
 * parked here and a super admin decides. Approving is what actually carries the
 * deletion out, so nothing can drift between the asking and the doing, and the
 * row is a permanent record of who asked, who approved, and what it removed.
 *
 * Who is gated (gateDelete):
 *   super_admin  deletes outright — someone has to be able to.
 *   admin / moderator   every delete below becomes a request.
 *   everyone else  unchanged: a user deleting their own invoice or contact is
 *                  self-service, not an administrative act, and was never the
 *                  thing being controlled here.
 *
 * Deliberately NOT gated, because they only affect the caller: suppressions,
 * their own connected mailbox, their own sender identity, and their own
 * invoice settings (bill-to addresses, company profiles).
 */

/* ------------------------------------------------------------------ *
 * What can be requested                                               *
 * ------------------------------------------------------------------ */

export type DeleteResource =
  | "company"
  | "company_bulk"
  | "contact"
  | "contact_bulk"
  | "invoice"
  | "offer"
  | "order"
  | "catalogue"
  | "offer_template"
  | "user"
  | "list_value";

export type DeleteTarget = {
  resource: DeleteResource;
  /** The row being deleted. Empty for a bulk request — its ids live in payload. */
  id?: string;
  /** Human name, captured NOW so the queue still reads sensibly after a rename
   *  and a decided request still says what it was about once the row is gone. */
  label?: string;
  /** Anything the executor needs when it eventually runs. */
  payload?: Record<string, any>;
};

/** What running a deletion produced. `detail` is stored on the request row. */
export type ExecOutcome =
  | { ok: true; detail: string }
  | { ok: false; error: string; status: number };

type Executor = {
  /** Shown in the queue: "Company", "Contacts (bulk)", … */
  noun: string;
  run: (req: DeleteRequestRow) => Promise<ExecOutcome>;
};

function idsOf(req: DeleteRequestRow): string[] {
  const raw = req.payload?.ids;
  return Array.isArray(raw) ? raw.filter((x: any) => typeof x === "string" && x) : [];
}

const EXECUTORS: Record<DeleteResource, Executor> = {
  company: {
    noun: "Company",
    async run(req) {
      // Same rule the direct delete enforces: a company with contacts still
      // pointing at it is never removed, or they are orphaned.
      const [cnt] = await db.execute(
        "SELECT COUNT(*) AS c FROM contacts WHERE company_id = ?",
        [req.resource_id]
      );
      const c = Number((cnt as any[])[0]?.c || 0);
      if (c > 0) {
        return {
          ok: false,
          status: 409,
          error: `${c} contact(s) still reference this company — detach or delete them first`,
        };
      }
      const [res]: any = await db.execute("DELETE FROM companies WHERE company_id = ?", [
        req.resource_id,
      ]);
      if (!(res?.affectedRows || 0)) {
        return { ok: false, status: 404, error: "That company no longer exists" };
      }
      return { ok: true, detail: "Company deleted" };
    },
  },

  company_bulk: {
    noun: "Companies (bulk)",
    async run(req) {
      const ids = idsOf(req);
      if (!ids.length) return { ok: false, status: 400, error: "No companies on the request" };

      const ph = ids.map(() => "?").join(",");
      const [blockedRows] = await db.query(
        `SELECT company_id FROM contacts WHERE company_id IN (${ph}) GROUP BY company_id`,
        ids
      );
      const blocked = new Set((blockedRows as any[]).map((r) => r.company_id));
      const deletable = ids.filter((id) => !blocked.has(id));
      if (!deletable.length) {
        return {
          ok: false,
          status: 409,
          error: `All ${ids.length} still have contacts linked to them`,
        };
      }

      const dph = deletable.map(() => "?").join(",");
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();
        await conn
          .query(`DELETE FROM company_assets_unlocks WHERE company_id IN (${dph})`, deletable)
          .catch(() => {
            /* table absent on older installs — non-fatal */
          });
        await conn.query(`DELETE FROM companies WHERE company_id IN (${dph})`, deletable);
        await conn.commit();
      } catch (e: any) {
        await conn.rollback();
        return { ok: false, status: 500, error: e?.message || "Delete failed" };
      } finally {
        conn.release();
      }
      const skipped = ids.length - deletable.length;
      return {
        ok: true,
        detail: `${deletable.length} deleted${skipped ? ` · ${skipped} skipped (have contacts)` : ""}`,
      };
    },
  },

  contact: {
    noun: "Contact",
    async run(req) {
      await db.execute("DELETE FROM unlocked_contacts WHERE contact_id = ?", [req.resource_id]);
      await db.execute("DELETE FROM contacts_unlocks WHERE contact_id = ?", [req.resource_id]);
      const [res]: any = await db.execute("DELETE FROM contacts WHERE id = ?", [req.resource_id]);
      if (!(res?.affectedRows || 0)) {
        return { ok: false, status: 404, error: "That contact no longer exists" };
      }
      return { ok: true, detail: "Contact deleted" };
    },
  },

  contact_bulk: {
    noun: "Contacts (bulk)",
    async run(req) {
      const ids = idsOf(req);
      if (!ids.length) return { ok: false, status: 400, error: "No contacts on the request" };

      const ph = ids.map(() => "?").join(",");
      const [rows] = await db.query(`SELECT id FROM contacts WHERE id IN (${ph})`, ids);
      const present = (rows as any[]).map((r) => r.id);
      if (!present.length) {
        return { ok: false, status: 404, error: "None of those contacts exist any more" };
      }

      const pph = present.map(() => "?").join(",");
      const conn = await db.getConnection();
      try {
        await conn.beginTransaction();
        await conn.query(`DELETE FROM unlocked_contacts WHERE contact_id IN (${pph})`, present);
        await conn.query(`DELETE FROM contacts_unlocks WHERE contact_id IN (${pph})`, present);
        await conn.query(`DELETE FROM contacts WHERE id IN (${pph})`, present);
        await conn.commit();
      } catch (e: any) {
        await conn.rollback();
        return { ok: false, status: 500, error: e?.message || "Delete failed" };
      } finally {
        conn.release();
      }
      const gone = ids.length - present.length;
      return {
        ok: true,
        detail: `${present.length} deleted${gone ? ` · ${gone} already gone` : ""}`,
      };
    },
  },

  // The four below stay scoped to the admin who asked: they could only ever
  // delete their own, and approval must not widen that.
  invoice: {
    noun: "Proforma invoice",
    async run(req) {
      const [res]: any = await db.execute(
        "DELETE FROM proforma_invoices WHERE id = ? AND user_id = ?",
        [req.resource_id, req.requested_by]
      );
      if (!(res?.affectedRows || 0)) {
        return { ok: false, status: 404, error: "That invoice no longer exists" };
      }
      return { ok: true, detail: "Invoice deleted" };
    },
  },

  offer: {
    noun: "Offer",
    async run(req) {
      const [res]: any = await db.execute("DELETE FROM offers WHERE id = ? AND user_id = ?", [
        req.resource_id,
        req.requested_by,
      ]);
      if (!(res?.affectedRows || 0)) {
        return { ok: false, status: 404, error: "That offer no longer exists" };
      }
      return { ok: true, detail: "Offer deleted" };
    },
  },

  order: {
    noun: "Order",
    async run(req) {
      const ok = await deleteOrder(req.requested_by, req.resource_id);
      return ok
        ? { ok: true, detail: "Order deleted" }
        : { ok: false, status: 404, error: "That order no longer exists" };
    },
  },

  offer_template: {
    noun: "Offer template",
    async run(req) {
      const ok = await deleteTemplate(req.requested_by, req.resource_id);
      return ok
        ? { ok: true, detail: "Template deleted" }
        : { ok: false, status: 404, error: "That template no longer exists" };
    },
  },

  catalogue: {
    noun: "Catalogue",
    async run(req) {
      const [res]: any = await db.execute("DELETE FROM company_catalogues WHERE id = ?", [
        req.resource_id,
      ]);
      if (!(res?.affectedRows || 0)) {
        return { ok: false, status: 404, error: "That catalogue no longer exists" };
      }
      return { ok: true, detail: "Catalogue deleted" };
    },
  },

  user: {
    noun: "User account",
    async run(req) {
      return deleteUserAccount(req.resource_id);
    },
  },

  list_value: {
    noun: "List value",
    async run(req) {
      const kind = String(req.payload?.kind || "") as VocabKind;
      if (!VOCAB_KINDS.includes(kind)) {
        return { ok: false, status: 400, error: "Unknown field" };
      }
      const term = req.resource_id;
      const col = VOCAB_COLUMN[kind];
      const conn = await db.getConnection();
      let cleared = 0;
      try {
        await conn.beginTransaction();
        const [res]: any = await conn.query(
          `UPDATE companies SET ${col} = NULL WHERE TRIM(${col}) = ?`,
          [term]
        );
        cleared = Number(res?.affectedRows) || 0;
        await deleteTerm(conn, kind, term);
        await deleteAliasesTo(conn, kind, term);
        await conn.commit();
      } catch (e: any) {
        await conn.rollback();
        return { ok: false, status: 500, error: e?.message || "Could not delete the value" };
      } finally {
        conn.release();
      }
      return {
        ok: true,
        detail: `“${term}” removed from ${VOCAB_LABEL[kind]}${
          cleared ? ` · cleared on ${cleared} ${cleared === 1 ? "company" : "companies"}` : ""
        }`,
      };
    },
  },
};

/**
 * Delete a user account and everything hanging off it.
 *
 * Lives here rather than in the route because approving a request has to run
 * exactly the same cascade the direct delete does — two copies of this would
 * drift, and the half that drifted would leave orphaned rows behind.
 */
export async function deleteUserAccount(userId: string): Promise<ExecOutcome> {
  const [rows] = await db.execute("SELECT id, role, email FROM users WHERE id = ? LIMIT 1", [
    userId,
  ]);
  const target = (rows as any[])[0];
  if (!target) return { ok: false, status: 404, error: "That account no longer exists" };

  // Never leave the platform with no one at the top, or no admin at all.
  if (target.role === "super_admin" || target.role === "admin") {
    const [[count]] = (await db.query("SELECT COUNT(*) AS n FROM users WHERE role = ?", [
      target.role,
    ])) as any;
    if (Number(count?.n || 0) <= 1) {
      return {
        ok: false,
        status: 400,
        error: `Cannot delete the last remaining ${
          target.role === "super_admin" ? "super admin" : "admin"
        }`,
      };
    }
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute("DELETE FROM credits_ledger WHERE user_id = ?", [userId]);
    await conn.execute("DELETE FROM credits_wallets WHERE user_id = ?", [userId]);
    await conn.execute("DELETE FROM wallet WHERE user_id = ?", [userId]);
    await conn.execute("DELETE FROM suppressions WHERE user_id = ?", [userId]);
    await conn.execute("DELETE FROM unlocked_contacts WHERE user_id = ?", [userId]);
    await conn.execute("DELETE FROM contacts_unlocks WHERE user_id = ?", [userId]);
    await conn.execute("DELETE FROM company_assets_unlocks WHERE user_id = ?", [userId]);
    await conn.execute("DELETE FROM email_identities WHERE user_id = ?", [userId]);
    await conn.execute("DELETE FROM email_verification_tokens WHERE user_id = ?", [userId]);
    await conn.execute("DELETE FROM password_reset_tokens WHERE user_id = ?", [userId]);
    await conn.execute(
      "DELETE FROM campaign_recipients WHERE user_id = ? OR campaign_id IN (SELECT id FROM campaigns WHERE user_id = ?)",
      [userId, userId]
    );
    await conn.execute("DELETE FROM campaigns WHERE user_id = ?", [userId]);

    const [contactRows] = await conn.execute(
      "SELECT id FROM contacts WHERE company_id IN (SELECT company_id FROM companies WHERE user_id = ?)",
      [userId]
    );
    const contactIds = (contactRows as any[]).map((r) => r.id);
    if (contactIds.length) {
      const ph = contactIds.map(() => "?").join(",");
      await conn.execute(`DELETE FROM unlocked_contacts WHERE contact_id IN (${ph})`, contactIds);
      await conn.execute(`DELETE FROM contacts_unlocks WHERE contact_id IN (${ph})`, contactIds);
      await conn.execute(`DELETE FROM contacts WHERE id IN (${ph})`, contactIds);
    }
    await conn.execute("DELETE FROM companies WHERE user_id = ?", [userId]);
    await conn.execute(
      "DELETE FROM pending_registrations WHERE email = (SELECT email FROM users WHERE id = ?)",
      [userId]
    );
    await conn.execute("DELETE FROM users WHERE id = ?", [userId]);
    await conn.commit();
  } catch (e: any) {
    await conn.rollback();
    return { ok: false, status: 500, error: e?.message || "Delete failed" };
  } finally {
    conn.release();
  }
  return { ok: true, detail: `Account ${target.email || userId} deleted` };
}

/* ------------------------------------------------------------------ *
 * The queue                                                           *
 * ------------------------------------------------------------------ */

export type DeleteRequestStatus = "pending" | "approved" | "rejected" | "failed";

export type DeleteRequestRow = {
  id: string;
  requested_by: string;
  resource: DeleteResource;
  resource_id: string;
  payload: Record<string, any> | null;
  label: string | null;
  reason: string | null;
  status: DeleteRequestStatus;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  outcome: string | null;
  created_at: string;
  /** Joined for display. */
  requested_by_email?: string | null;
  decided_by_email?: string | null;
};

/**
 * Idempotently create the queue table, the same way lib/modPageAccess.ts does
 * for moderator_page_access.
 *
 * Without it the deploy order decides whether the app works: the moment this
 * code is live, an admin's delete writes here, and if the migration hasn't been
 * applied yet every one of them 500s. Cheap on an existing install, and the
 * migration stays the place the schema is written down.
 */
let ensured = false;
async function ensureTable(): Promise<void> {
  if (ensured) return;
  await db.execute(`
    CREATE TABLE IF NOT EXISTS delete_requests (
      id            CHAR(36)     NOT NULL,
      requested_by  CHAR(36)     NOT NULL,
      resource      VARCHAR(32)  NOT NULL,
      resource_id   VARCHAR(191) NOT NULL DEFAULT '',
      payload       TEXT         NULL,
      label         VARCHAR(255) NULL,
      reason        VARCHAR(512) NULL,
      status        VARCHAR(16)  NOT NULL DEFAULT 'pending',
      decided_by    CHAR(36)     NULL,
      decided_at    DATETIME     NULL,
      decision_note VARCHAR(512) NULL,
      outcome       VARCHAR(512) NULL,
      created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_status    (status, created_at),
      KEY idx_requester (requested_by, created_at),
      KEY idx_target    (resource, resource_id, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
  ensured = true;
}

function hydrate(r: any): DeleteRequestRow {
  let payload: Record<string, any> | null = null;
  try {
    payload = r.payload ? JSON.parse(String(r.payload)) : null;
  } catch {
    payload = null;
  }
  return { ...r, payload };
}

/** The human noun for a resource, for the queue and for toasts. */
export function resourceNoun(resource: string): string {
  return EXECUTORS[resource as DeleteResource]?.noun ?? resource;
}

/**
 * The gate every controlled delete calls once it has established the caller is
 * allowed to delete this thing at all.
 *
 * Returns `{ allowed: true }` to carry on, or a pending request to hand back
 * as 202 — accepted, but not done.
 */
export async function gateDelete(
  session: { id: string; role?: string | null },
  target: DeleteTarget
): Promise<{ allowed: true } | { allowed: false; request: DeleteRequestRow; message: string }> {
  if (isSuperAdmin(session.role)) return { allowed: true };
  if (!isStaff(session.role)) return { allowed: true };

  const existing = await findPendingFor(session.id, target);
  const request = existing ?? (await createDeleteRequest(session.id, target));
  return {
    allowed: false,
    request,
    message: existing
      ? "You have already asked to delete this. It is waiting for a super admin."
      : "Sent to a super admin for approval. It will be deleted once they approve.",
  };
}

/**
 * 202 Accepted — the request was taken, the thing is still there.
 *
 * Deliberately a success status: nothing went wrong, so a client that only
 * checks `res.ok` doesn't show a scary error. Clients MUST look at `pending`
 * before telling the user it was deleted or dropping the row from the list.
 */
export function pendingDeleteResponse(gate: {
  request: DeleteRequestRow;
  message: string;
}): NextResponse {
  return NextResponse.json(
    { pending: true, request_id: gate.request.id, message: gate.message },
    { status: 202 }
  );
}

/** An identical pending ask from the same person, so a second click doesn't
 *  stack up duplicates in the queue. Bulk requests are never deduped — the id
 *  list differs each time. */
async function findPendingFor(
  userId: string,
  target: DeleteTarget
): Promise<DeleteRequestRow | null> {
  if (!target.id) return null;
  await ensureTable();
  const [rows] = await db.execute(
    `SELECT * FROM delete_requests
      WHERE requested_by = ? AND resource = ? AND resource_id = ? AND status = 'pending'
      ORDER BY created_at DESC LIMIT 1`,
    [userId, target.resource, target.id]
  );
  const row = (rows as any[])[0];
  return row ? hydrate(row) : null;
}

export async function createDeleteRequest(
  userId: string,
  target: DeleteTarget
): Promise<DeleteRequestRow> {
  await ensureTable();
  const id = randomUUID();
  await db.execute(
    `INSERT INTO delete_requests (id, requested_by, resource, resource_id, payload, label, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      userId,
      target.resource,
      target.id ?? "",
      target.payload ? JSON.stringify(target.payload) : null,
      target.label ? String(target.label).slice(0, 255) : null,
      target.payload?.reason ? String(target.payload.reason).slice(0, 512) : null,
    ]
  );
  const [rows] = await db.execute("SELECT * FROM delete_requests WHERE id = ? LIMIT 1", [id]);
  return hydrate((rows as any[])[0]);
}

/**
 * The queue. A super admin sees everyone's; an admin sees only their own, so
 * they can tell whether what they asked for has been decided.
 */
export async function listDeleteRequests(opts: {
  status?: DeleteRequestStatus | "all";
  requestedBy?: string;
  limit?: number;
}): Promise<DeleteRequestRow[]> {
  await ensureTable();
  const where: string[] = [];
  const params: any[] = [];
  if (opts.status && opts.status !== "all") {
    where.push("d.status = ?");
    params.push(opts.status);
  }
  if (opts.requestedBy) {
    where.push("d.requested_by = ?");
    params.push(opts.requestedBy);
  }
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
  const [rows] = await db.query(
    `SELECT d.*, u.email AS requested_by_email, a.email AS decided_by_email
       FROM delete_requests d
       LEFT JOIN users u ON u.id = d.requested_by
       LEFT JOIN users a ON a.id = d.decided_by
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY d.created_at DESC
      LIMIT ${limit}`,
    params
  );
  return (rows as any[]).map(hydrate);
}

export async function countPendingDeleteRequests(): Promise<number> {
  await ensureTable();
  const [rows] = await db.execute(
    "SELECT COUNT(*) AS n FROM delete_requests WHERE status = 'pending'"
  );
  return Number((rows as any[])[0]?.n || 0);
}

/**
 * Approve or reject. Approving RUNS the deletion — that is the whole point of
 * storing what was asked for.
 *
 * A deletion that fails when it runs (the row is gone, a company grew contacts
 * while it waited) is recorded as `failed` with the reason rather than
 * `approved`, so the queue never claims something was removed that wasn't.
 */
export async function decideDeleteRequest(
  requestId: string,
  superAdminId: string,
  approve: boolean,
  note: string | null
): Promise<{ ok: boolean; error?: string; status?: DeleteRequestStatus; outcome?: string }> {
  await ensureTable();
  const [rows] = await db.execute(
    "SELECT * FROM delete_requests WHERE id = ? LIMIT 1",
    [requestId]
  );
  const raw = (rows as any[])[0];
  if (!raw) return { ok: false, error: "Request not found" };
  const req = hydrate(raw);
  if (req.status !== "pending") {
    return { ok: false, error: `That request was already ${req.status}` };
  }

  if (!approve) {
    await db.execute(
      `UPDATE delete_requests
          SET status = 'rejected', decided_by = ?, decided_at = NOW(), decision_note = ?
        WHERE id = ? AND status = 'pending'`,
      [superAdminId, note, requestId]
    );
    return { ok: true, status: "rejected" };
  }

  const executor = EXECUTORS[req.resource];
  if (!executor) {
    await db.execute(
      `UPDATE delete_requests
          SET status = 'failed', decided_by = ?, decided_at = NOW(), decision_note = ?, outcome = ?
        WHERE id = ?`,
      [superAdminId, note, `Unknown resource "${req.resource}"`, requestId]
    );
    return { ok: false, error: `Unknown resource "${req.resource}"` };
  }

  const result = await executor.run(req);
  const outcome = result.ok ? result.detail : result.error;
  await db.execute(
    `UPDATE delete_requests
        SET status = ?, decided_by = ?, decided_at = NOW(), decision_note = ?, outcome = ?
      WHERE id = ?`,
    [result.ok ? "approved" : "failed", superAdminId, note, outcome.slice(0, 512), requestId]
  );

  return result.ok
    ? { ok: true, status: "approved", outcome: result.detail }
    : { ok: false, error: result.error, status: "failed" };
}
