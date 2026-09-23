import { randomUUID } from "crypto";
import { db } from "./db";
import { HttpError } from "./auth";
import { COMPANY_TEXT_FIELDS, companyNameKey, findCompanyByName, type CompanyProfile } from "./companyProfiles";
import { isAdmin } from "./roles";

/**
 * DB access for company profiles (rows of invoice_settings).
 *
 * Admins share their companies: an admin sees, uses and edits every company
 * any admin has saved, so a company set up once (Race Innovations, say) is
 * there for all of them. Anyone else sees only their own. A row still belongs
 * to the login that saved it (user_id); the sharing is in what each viewer can
 * reach — see companyOwners().
 *
 * Ordering is "default first, then the viewer's own, then oldest": every read
 * that used to take a user's single settings row now takes their default
 * company, which for a user with one company is the very same row.
 */

const ORDER = "ORDER BY is_default DESC, (user_id = ?) DESC, created_at ASC, id ASC";

function s(v: unknown, max = 4000): string | null {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t ? t.slice(0, max) : null;
}

/**
 * The logins whose companies this user can reach: every admin's, for an
 * admin; otherwise just their own. The user is always included, so a
 * demoted admin still sees what they saved.
 */
export async function companyOwners(userId: string): Promise<string[]> {
  const [me] = await db.execute("SELECT role FROM users WHERE id = ? LIMIT 1", [userId]);
  if (!isAdmin((me as any[])[0]?.role)) return [userId];
  const [rows] = await db.execute("SELECT id FROM users WHERE role IN ('admin', 'super_admin')");
  return Array.from(new Set([userId, ...(rows as any[]).map((r) => String(r.id))]));
}

/**
 * Two admins who each saved the same company (by name, punctuation and case
 * aside) would otherwise both see it twice. The first in ORDER wins — the
 * default, else the viewer's own. Unnamed rows are never merged.
 */
function dedupeByName(rows: CompanyProfile[]): CompanyProfile[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const key = companyNameKey(r.seller_company || r.label) || `id:${r.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function listCompanyProfiles(userId: string): Promise<CompanyProfile[]> {
  const owners = await companyOwners(userId);
  const [rows] = await db.query(
    `SELECT * FROM invoice_settings WHERE user_id IN (?) ${ORDER} LIMIT 200`,
    [owners, userId]
  );
  return dedupeByName(rows as CompanyProfile[]).slice(0, 100);
}

export async function getCompanyProfile(userId: string, id: string): Promise<CompanyProfile | null> {
  const owners = await companyOwners(userId);
  const [rows] = await db.query(
    "SELECT * FROM invoice_settings WHERE user_id IN (?) AND id = ? LIMIT 1",
    [owners, id]
  );
  return ((rows as CompanyProfile[])[0] as CompanyProfile) || null;
}

/** The company used when an invoice doesn't name one (and by offers). */
export async function getDefaultCompanyProfile(userId: string): Promise<CompanyProfile | null> {
  return (await listCompanyProfiles(userId))[0] || null;
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

/**
 * The company an invoice is issued as, taking the typed seller name into account.
 *
 * The form picks a company, but its "Company name" box stays editable. When the
 * typed name is a different company from the one picked, printing the picked
 * company's logo, seal and number series under it would be the wrong
 * letterhead, so:
 *
 *   * a name matching another saved company switches to that company;
 *   * a name matching nothing, with `save_seller_company` set, is saved as a
 *     new company (when `create` is true) and the invoice is issued as it —
 *     no logo, signature or seal until some are uploaded for it;
 *   * otherwise the picked company stands, as before.
 *
 * `create: false` (the preview) never writes: a company that would be created
 * comes back as null, so the preview shows no other company's images either.
 */
export async function resolveSellerProfile(
  userId: string,
  body: Record<string, any>,
  opts: { create: boolean }
): Promise<{ profile: CompanyProfile | null; created: boolean }> {
  const picked = await resolveCompanyProfile(userId, body.company_profile_id);
  const typed = s(body.seller_company, 255);
  if (!typed) return { profile: picked, created: false };
  if (picked && findCompanyByName([picked], typed)) return { profile: picked, created: false };

  const match = findCompanyByName(await listCompanyProfiles(userId), typed);
  if (match) return { profile: match, created: false };
  if (!body.save_seller_company) return { profile: picked, created: false };
  if (!opts.create) return { profile: null, created: false };

  const profile = await createCompanyProfile(userId, {
    values: {
      label: typed,
      seller_company: typed,
      seller_address: s(body.seller_address, 2000),
      gstin: s(body.seller_gstin, 32)?.toUpperCase() ?? null,
      pan: s(body.seller_pan, 32)?.toUpperCase() ?? null,
      email: s(body.seller_email, 255),
      phone: s(body.seller_phone, 64),
      bank_name: s(body.bank_name, 255),
      bank_account: s(body.bank_account, 64),
      bank_branch: s(body.bank_branch, 255),
      bank_ifsc: s(body.bank_ifsc, 32)?.toUpperCase() ?? null,
      payment_terms: s(body.payment_terms, 512),
      delivery_terms: s(body.delivery_terms, 255),
      declaration: s(body.declaration, 2000),
      signatory_name: s(body.signatory_name, 255),
    },
  });
  return { profile, created: true };
}

export type CompanyProfileWrite = {
  /** Text columns; only the keys present are written. */
  values: Record<string, string | null>;
  /** Set only when a new file was uploaded, so saving text keeps the old image. */
  logo_path?: string;
  signature_path?: string;
  seal_path?: string;
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
  if (write.seal_path !== undefined) {
    cols.push("seal_path");
    params.push(write.seal_path);
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
  if (write.seal_path !== undefined) {
    sets.push("seal_path = ?");
    params.push(write.seal_path);
  }
  if (sets.length) {
    // `existing` was found within this user's reach; the row itself may be
    // another admin's, so it is addressed by its id alone.
    await db.execute(`UPDATE invoice_settings SET ${sets.join(", ")} WHERE id = ?`, [...params, existing.id]);
  }
  return (await getCompanyProfile(userId, id)) as CompanyProfile;
}

/**
 * Exactly one default across everything this user can reach — setting one
 * clears the rest in the same statement. For admins that is one shared
 * default, so every admin's invoice form opens on the same company.
 */
export async function setDefaultCompanyProfile(userId: string, id: string): Promise<void> {
  const found = await getCompanyProfile(userId, id);
  if (!found) throw new HttpError(404, "Company not found.");
  const owners = await companyOwners(userId);
  await db.query("UPDATE invoice_settings SET is_default = (id = ?) WHERE user_id IN (?)", [id, owners]);
}

/**
 * Invoices already issued keep their own snapshot of the seller, so deleting a
 * company changes nothing that has gone out. If the default is deleted the
 * oldest remaining company takes over, so nobody is left with companies but
 * no default.
 */
export async function deleteCompanyProfile(userId: string, id: string): Promise<boolean> {
  const existing = await getCompanyProfile(userId, id);
  if (!existing) return false;
  await db.execute("DELETE FROM invoice_settings WHERE id = ?", [existing.id]);
  if (existing.is_default) {
    const owners = await companyOwners(userId);
    await db.query(
      "UPDATE invoice_settings SET is_default = 1 WHERE user_id IN (?) ORDER BY created_at ASC LIMIT 1",
      [owners]
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
          WHERE id = ?`,
        [bank.name, bank.account, bank.branch, bank.ifsc, target.id]
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
