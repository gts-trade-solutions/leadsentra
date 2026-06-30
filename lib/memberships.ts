import { randomUUID } from "crypto";
import { db } from "./db";

/**
 * Company membership (join request) helpers.
 *
 * Lifecycle: a user requests to join an existing company -> `pending` ->
 * a platform admin approves (`approved`) or rejects (`rejected`). Approved
 * companies are surfaced to the user across the company-scoped UI.
 */

export type MembershipStatus = "pending" | "approved" | "rejected";

export type MembershipRow = {
  id: string;
  company_id: string;
  company_name: string;
  status: MembershipStatus;
  note: string | null;
  requested_at: string;
  decided_at: string | null;
};

export type PendingRequestRow = {
  id: string;
  user_id: string;
  user_email: string;
  user_name: string | null;
  company_id: string;
  company_name: string;
  status: MembershipStatus;
  requested_at: string;
};

/**
 * Create (or re-open) a join request for a user+company. Returns the resulting
 * status. If a membership already exists: 'approved'/'pending' are left as-is;
 * a previously 'rejected' one is re-opened to 'pending'. Validates the company
 * exists.
 */
export async function requestMembership(
  userId: string,
  companyId: string
): Promise<{ status: MembershipStatus } | { error: string }> {
  const [companyRows] = await db.execute(
    "SELECT company_id FROM companies WHERE company_id = ? LIMIT 1",
    [companyId]
  );
  if (!(companyRows as any[]).length) return { error: "Company not found." };

  const [existingRows] = await db.execute(
    "SELECT id, status FROM company_memberships WHERE user_id = ? AND company_id = ? LIMIT 1",
    [userId, companyId]
  );
  const existing = (existingRows as any[])[0];
  if (existing) {
    if (existing.status === "rejected") {
      await db.execute(
        "UPDATE company_memberships SET status = 'pending', note = NULL, requested_at = CURRENT_TIMESTAMP, decided_at = NULL, decided_by = NULL WHERE id = ?",
        [existing.id]
      );
      return { status: "pending" };
    }
    return { status: existing.status as MembershipStatus };
  }

  await db.execute(
    "INSERT INTO company_memberships (id, user_id, company_id, status) VALUES (?, ?, ?, 'pending')",
    [randomUUID(), userId, companyId]
  );
  return { status: "pending" };
}

/**
 * Build a SQL predicate that limits company-scoped rows (e.g. contacts) to what
 * a regular user may access: rows under a company they OWN, a GLOBAL company
 * (user_id IS NULL), a company they're an APPROVED member of, or rows they
 * created themselves. Returns the parenthesised clause + ordered params.
 *
 * `companyAlias` is the joined companies table; `rowAlias` the scoped table
 * (must have user_id and company_id columns).
 */
export async function accessibleCompanyFilter(
  userId: string,
  rowAlias: string,
  companyAlias: string
): Promise<{ sql: string; params: any[] }> {
  const approved = await getApprovedCompanyIds(userId);
  // The row must be CONNECTED to a real company the user can access:
  // a company they own, a global company, or one they're an approved member of.
  // (companyAlias.company_id IS NOT NULL filters out unconnected/orphan rows —
  // a LEFT JOIN miss would otherwise slip through the "user_id IS NULL" clause.)
  const accessible = [
    `${companyAlias}.user_id = ?`,
    `${companyAlias}.user_id IS NULL`,
  ];
  const params: any[] = [userId];
  if (approved.length) {
    accessible.push(`${rowAlias}.company_id IN (${approved.map(() => "?").join(", ")})`);
    params.push(...approved);
  }
  return {
    sql: `(${companyAlias}.company_id IS NOT NULL AND (${accessible.join(" OR ")}))`,
    params,
  };
}

/** Company ids the user is an approved member of. */
export async function getApprovedCompanyIds(userId: string): Promise<string[]> {
  const [rows] = await db.execute(
    "SELECT company_id FROM company_memberships WHERE user_id = ? AND status = 'approved'",
    [userId]
  );
  return (rows as any[]).map((r) => String(r.company_id));
}

/** All of a user's memberships (any status) with company names. */
export async function listUserMemberships(userId: string): Promise<MembershipRow[]> {
  const [rows] = await db.execute(
    `SELECT m.id, m.company_id, m.status, m.note,
            m.requested_at, m.decided_at,
            COALESCE(c.company_name, m.company_id) AS company_name
       FROM company_memberships m
       LEFT JOIN companies c ON c.company_id = m.company_id
      WHERE m.user_id = ?
      ORDER BY m.requested_at DESC`,
    [userId]
  );
  return (rows as any[]).map((r) => ({
    id: r.id,
    company_id: r.company_id,
    company_name: r.company_name,
    status: r.status,
    note: r.note,
    requested_at: String(r.requested_at),
    decided_at: r.decided_at ? String(r.decided_at) : null,
  }));
}

/** Admin: list join requests (defaults to pending) with user + company info. */
export async function listRequests(status: MembershipStatus | "all" = "pending"): Promise<PendingRequestRow[]> {
  const where = status === "all" ? "" : "WHERE m.status = ?";
  const params = status === "all" ? [] : [status];
  const [rows] = await db.execute(
    `SELECT m.id, m.user_id, m.company_id, m.status, m.requested_at,
            u.email AS user_email, u.full_name AS user_name,
            COALESCE(c.company_name, m.company_id) AS company_name
       FROM company_memberships m
       LEFT JOIN users u ON u.id = m.user_id
       LEFT JOIN companies c ON c.company_id = m.company_id
       ${where}
      ORDER BY m.requested_at DESC
      LIMIT 1000`,
    params
  );
  return (rows as any[]).map((r) => ({
    id: r.id,
    user_id: r.user_id,
    user_email: r.user_email || "(unknown)",
    user_name: r.user_name,
    company_id: r.company_id,
    company_name: r.company_name,
    status: r.status,
    requested_at: String(r.requested_at),
  }));
}

/** Count of pending requests (for an admin badge). */
export async function countPendingRequests(): Promise<number> {
  const [rows] = await db.execute(
    "SELECT COUNT(*) AS n FROM company_memberships WHERE status = 'pending'"
  );
  return Number((rows as any[])[0]?.n || 0);
}

/** Admin: approve or reject a request. Returns false if the id doesn't exist. */
export async function decideRequest(
  requestId: string,
  adminId: string,
  approve: boolean,
  note?: string | null
): Promise<boolean> {
  const [res] = await db.execute(
    `UPDATE company_memberships
        SET status = ?, decided_at = CURRENT_TIMESTAMP, decided_by = ?, note = ?
      WHERE id = ?`,
    [approve ? "approved" : "rejected", adminId, note ?? null, requestId]
  );
  return ((res as any)?.affectedRows || 0) > 0;
}
