import { randomUUID } from "crypto";
import { db } from "./db";
import { HttpError } from "./auth";
import { COMPANY_TEXT_FIELDS, type CompanyProfile } from "./companyProfiles";

/**
 * DB access for company profiles (rows of invoice_settings).
 *
 * Ordering is always "default first, then oldest": every read that used to
 * take a user's single settings row now takes their default company, which
 * for a user with one company is the very same row.
 */

const ORDER = "ORDER BY is_default DESC, created_at ASC, id ASC";

function s(v: unknown, max = 4000): string | null {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t ? t.slice(0, max) : null;
}

export async function listCompanyProfiles(userId: string): Promise<CompanyProfile[]> {
  const [rows] = await db.execute(
    `SELECT * FROM invoice_settings WHERE user_id = ? ${ORDER} LIMIT 100`,
    [userId]
  );
  return rows as CompanyProfile[];
}

export async function getCompanyProfile(userId: string, id: string): Promise<CompanyProfile | null> {
  const [rows] = await db.execute(
    "SELECT * FROM invoice_settings WHERE user_id = ? AND id = ? LIMIT 1",
    [userId, id]
  );
  return ((rows as CompanyProfile[])[0] as CompanyProfile) || null;
}

/** The company used when an invoice doesn't name one (and by offers). */
export async function getDefaultCompanyProfile(userId: string): Promise<CompanyProfile | null> {
  const [rows] = await db.execute(
    `SELECT * FROM invoice_settings WHERE user_id = ? ${ORDER} LIMIT 1`,
    [userId]
  );
  return ((rows as CompanyProfile[])[0] as CompanyProfile) || null;
}

/**
 * The company an invoice is being issued as: the one it names, or the default.
 *
 * An id that isn't this user's falls back to the default rather than failing —
 * a stale id in a form should not stop an invoice being saved.
 */
export async function resolveCompanyProfile(
  userId: string,
  id?: string | null
): Promise<CompanyProfile | null> {
  const wanted = s(id, 36);
  if (wanted) {
    const found = await getCompanyProfile(userId, wanted);
    if (found) return found;
  }
  return getDefaultCompanyProfile(userId);
}

export type CompanyProfileWrite = {
  /** Text columns; only the keys present are written. */
  values: Record<string, string | null>;
  /** Set only when a new file was uploaded, so saving text keeps the old image. */
  logo_path?: string;
  signature_path?: string;
};

export async function createCompanyProfile(
  userId: string,
  write: CompanyProfileWrite
): Promise<CompanyProfile> {
  const id = randomUUID();
  const cols: string[] = [];
  const params: any[] = [];
  for (const f of COMPANY_TEXT_FIELDS) {
    cols.push(`\`${f}\``);
    params.push(write.values[f] ?? null);
  }
  if (write.logo_path !== undefined) {
    cols.push("logo_path");
    params.push(write.logo_path);
  }
  if (write.signature_path !== undefined) {
    cols.push("signature_path");
    params.push(write.signature_path);
  }

  // The first company a user saves is their default — otherwise nothing would
  // be, and every fallback read would come back empty.
  const existing = await listCompanyProfiles(userId);
  const isDefault = existing.length === 0 ? 1 : 0;

  await db.execute(
    `INSERT INTO invoice_settings (id, user_id, is_default, ${cols.join(", ")})
     VALUES (?, ?, ?, ${cols.map(() => "?").join(", ")})`,
    [id, userId, isDefault, ...params]
  );
  return (await getCompanyProfile(userId, id)) as CompanyProfile;
}

export async function updateCompanyProfile(
  userId: string,
  id: string,
  write: CompanyProfileWrite
): Promise<CompanyProfile> {
  const existing = await getCompanyProfile(userId, id);
  if (!existing) throw new HttpError(404, "Company not found.");

  const sets: string[] = [];
  const params: any[] = [];
  for (const f of COMPANY_TEXT_FIELDS) {
    if (!(f in write.values)) continue;
    sets.push(`\`${f}\` = ?`);
    params.push(write.values[f] ?? null);
  }
  if (write.logo_path !== undefined) {
    sets.push("logo_path = ?");
    params.push(write.logo_path);
  }
  if (write.signature_path !== undefined) {
    sets.push("signature_path = ?");
    params.push(write.signature_path);
  }
  if (sets.length) {
    await db.execute(
      `UPDATE invoice_settings SET ${sets.join(", ")} WHERE user_id = ? AND id = ?`,
      [...params, userId, id]
    );
  }
  return (await getCompanyProfile(userId, id)) as CompanyProfile;
}

/** Exactly one default per user — setting one clears the rest in the same statement. */
export async function setDefaultCompanyProfile(userId: string, id: string): Promise<void> {
  const found = await getCompanyProfile(userId, id);
  if (!found) throw new HttpError(404, "Company not found.");
  await db.execute("UPDATE invoice_settings SET is_default = (id = ?) WHERE user_id = ?", [id, userId]);
}

/**
 * Invoices already issued keep their own snapshot of the seller, so deleting a
 * company changes nothing that has gone out. If the default is deleted the
 * oldest remaining company takes over, so a user is never left with companies
 * but no default.
 */
export async function deleteCompanyProfile(userId: string, id: string): Promise<boolean> {
  const existing = await getCompanyProfile(userId, id);
  if (!existing) return false;
  await db.execute("DELETE FROM invoice_settings WHERE user_id = ? AND id = ?", [userId, id]);
  if (existing.is_default) {
    await db.execute(
      "UPDATE invoice_settings SET is_default = 1 WHERE user_id = ? ORDER BY created_at ASC LIMIT 1",
      [userId]
    );
  }
  return true;
}

/**
 * Keep the bank block typed on an invoice as that company's bank details.
 * Never throws: the invoice is already committed by the time this runs.
 */
export async function rememberBankDetails(
  userId: string,
  profileId: string | null,
  bank: { name: string | null; account: string | null; branch: string | null; ifsc: string | null }
): Promise<void> {
  if (![bank.name, bank.account, bank.branch, bank.ifsc].some((v) => String(v || "").trim())) return;
  try {
    const target = profileId
      ? await getCompanyProfile(userId, profileId)
      : await getDefaultCompanyProfile(userId);

    if (target) {
      await db.execute(
        `UPDATE invoice_settings
            SET bank_name = ?, bank_account = ?, bank_branch = ?, bank_ifsc = ?
          WHERE user_id = ? AND id = ?`,
        [bank.name, bank.account, bank.branch, bank.ifsc, userId, target.id]
      );
      return;
    }
    // No company saved yet: start one from what this invoice carried, so the
    // details are not lost and the next invoice pre-fills them.
    await createCompanyProfile(userId, {
      values: {
        label: "My company",
        bank_name: bank.name,
        bank_account: bank.account,
        bank_branch: bank.branch,
        bank_ifsc: bank.ifsc,
      },
    });
  } catch (e) {
    console.warn("[invoices] could not save the bank details against the company", e);
  }
}
