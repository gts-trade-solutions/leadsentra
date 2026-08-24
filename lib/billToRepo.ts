import { randomUUID } from "crypto";
import { db } from "./db";
import { HttpError } from "./auth";
import { parseRecipients } from "./invoices";
import { missingBillToFields, type BillToAddress, type BillToInput } from "./billTo";

/**
 * DB access for the saved "Bill To" address book. The pure types and the
 * address formatting live in lib/billTo.ts so the client can share them.
 */

const SELECT_COLS = `id, \`label\`, \`name\`, company, category, email, phone, gstin, pan,
       country, address_line1, address_line2, city, \`state\`, pincode,
       contact_id, company_id, last_used_at, created_at, updated_at`;

/** Editable columns, with the cap each one's column can hold. */
const FIELDS: { key: keyof BillToInput; col: string; max: number }[] = [
  { key: "label", col: "`label`", max: 255 },
  { key: "name", col: "`name`", max: 255 },
  { key: "company", col: "company", max: 255 },
  { key: "category", col: "category", max: 64 },
  { key: "email", col: "email", max: 255 },
  { key: "phone", col: "phone", max: 64 },
  { key: "gstin", col: "gstin", max: 32 },
  { key: "pan", col: "pan", max: 32 },
  { key: "country", col: "country", max: 64 },
  { key: "address_line1", col: "address_line1", max: 512 },
  { key: "address_line2", col: "address_line2", max: 512 },
  { key: "city", col: "city", max: 128 },
  { key: "state", col: "`state`", max: 128 },
  { key: "pincode", col: "pincode", max: 16 },
  { key: "contact_id", col: "contact_id", max: 36 },
  { key: "company_id", col: "company_id", max: 36 },
];

const UPPERCASE_FIELDS: (keyof BillToInput)[] = ["gstin", "pan"];

function s(v: unknown, max: number): string | null {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t ? t.slice(0, max) : null;
}

/**
 * Validate and normalise an incoming address.
 *
 * `base` is the row being edited: a PATCH only sends what changed, so the
 * required-field check runs on the merged result, not on the patch alone.
 */
export function sanitizeBillTo(
  body: any,
  base?: BillToAddress | null
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const { key, max } of FIELDS) {
    const supplied = body && typeof body === "object" && key in body;
    const raw = supplied ? body[key] : base ? (base as any)[key] : null;
    let value = s(raw, max);
    if (value && UPPERCASE_FIELDS.includes(key)) value = value.toUpperCase();
    out[key] = value;
  }

  const missing = missingBillToFields(out as unknown as BillToInput);
  if (missing.length) {
    throw new HttpError(400, `${missing.join(", ")} ${missing.length > 1 ? "are" : "is"} required.`);
  }

  if (out.email) {
    const parsed = parseRecipients(out.email);
    if (parsed.invalid.length || parsed.valid.length !== 1) {
      throw new HttpError(400, `"${out.email}" is not a valid email address.`);
    }
    out.email = parsed.valid[0];
  }
  return out;
}

/** This user's saved addresses, most recently used first. */
export async function listBillTo(userId: string, limit = 500): Promise<BillToAddress[]> {
  const capped = Math.min(Math.max(Number(limit) || 500, 1), 2000);
  const [rows] = await db.execute(
    `SELECT ${SELECT_COLS}
       FROM invoice_bill_to_addresses
      WHERE user_id = ?
      ORDER BY last_used_at IS NULL, last_used_at DESC, created_at DESC
      LIMIT ${capped}`,
    [userId]
  );
  return rows as BillToAddress[];
}

export async function getBillTo(userId: string, id: string): Promise<BillToAddress | null> {
  const [rows] = await db.execute(
    `SELECT ${SELECT_COLS} FROM invoice_bill_to_addresses WHERE user_id = ? AND id = ? LIMIT 1`,
    [userId, id]
  );
  return ((rows as BillToAddress[])[0] as BillToAddress) || null;
}

export async function createBillTo(userId: string, body: any): Promise<BillToAddress> {
  const values = sanitizeBillTo(body);
  const id = randomUUID();
  const cols = FIELDS.map((f) => f.col).join(", ");
  const placeholders = FIELDS.map(() => "?").join(", ");
  await db.execute(
    `INSERT INTO invoice_bill_to_addresses (id, user_id, ${cols})
     VALUES (?, ?, ${placeholders})`,
    [id, userId, ...FIELDS.map((f) => values[f.key])]
  );
  const created = await getBillTo(userId, id);
  if (!created) throw new HttpError(500, "Address was saved but could not be read back.");
  return created;
}

export async function updateBillTo(userId: string, id: string, body: any): Promise<BillToAddress> {
  const existing = await getBillTo(userId, id);
  if (!existing) throw new HttpError(404, "Address not found.");
  const values = sanitizeBillTo(body, existing);
  const sets = FIELDS.map((f) => `${f.col} = ?`).join(", ");
  await db.execute(
    `UPDATE invoice_bill_to_addresses SET ${sets} WHERE user_id = ? AND id = ?`,
    [...FIELDS.map((f) => values[f.key]), userId, id]
  );
  return (await getBillTo(userId, id)) as BillToAddress;
}

export async function deleteBillTo(userId: string, id: string): Promise<boolean> {
  const [res] = await db.execute(
    "DELETE FROM invoice_bill_to_addresses WHERE user_id = ? AND id = ?",
    [userId, id]
  );
  return ((res as any)?.affectedRows || 0) > 0;
}

/** Mark an address as used, so the picker keeps the day-to-day customers on top. */
export async function touchBillTo(userId: string, id: string): Promise<void> {
  await db.execute(
    "UPDATE invoice_bill_to_addresses SET last_used_at = NOW() WHERE user_id = ? AND id = ?",
    [userId, id]
  );
}

export type CapturedCustomer = {
  name?: string | null;
  company?: string | null;
  email?: string | null;
  phone?: string | null;
  gstin?: string | null;
  pan?: string | null;
  address?: string | null;
  contact_id?: string | null;
  company_id?: string | null;
};

/**
 * Split the invoice's free-text address block into the stored two lines:
 * first line, then the rest. Both are textareas on the form and both keep
 * their newlines, so the address reads back exactly as it was typed — the
 * city/state/pincode parts stay empty until someone fills them in by hand
 * rather than being guessed at out of prose.
 */
function splitAddress(address: string | null | undefined): { line1: string | null; line2: string | null } {
  const lines = String(address || "")
    .split(/\r?\n/)
    .map((t) => t.trim())
    .filter(Boolean);
  return {
    line1: lines[0] ? lines[0].slice(0, 512) : null,
    line2: lines.length > 1 ? lines.slice(1).join("\n").slice(0, 512) : null,
  };
}

/**
 * Remember the customer an invoice was just raised for, so the next invoice
 * only needs their email picked. Called after the invoice is safely committed
 * and deliberately swallows its own errors — the address book is a
 * convenience, and failing to write it must never fail an invoice.
 *
 * An existing row is only topped up where it is blank: a saved address the
 * user has corrected by hand outranks whatever was typed on one invoice.
 */
export async function captureBillTo(userId: string, customer: CapturedCustomer): Promise<void> {
  try {
    const email = s(customer.email, 255)?.toLowerCase() || null;
    const name = s(customer.name, 255);
    const company = s(customer.company, 255);
    const label = name || company || email;
    if (!label) return;

    // Match on the email first — that is the handle people invoice by. With no
    // email, fall back to an exact label match so re-invoicing the same walk-in
    // customer doesn't stack up duplicates.
    const [rows] = email
      ? await db.execute(
          `SELECT id FROM invoice_bill_to_addresses
            WHERE user_id = ? AND LOWER(email) = ?
            ORDER BY last_used_at IS NULL, last_used_at DESC, created_at DESC
            LIMIT 1`,
          [userId, email]
        )
      : await db.execute(
          `SELECT id FROM invoice_bill_to_addresses
            WHERE user_id = ? AND LOWER(\`label\`) = ? LIMIT 1`,
          [userId, label.toLowerCase()]
        );
    const found = (rows as any[])[0];

    const { line1, line2 } = splitAddress(customer.address);
    const phone = s(customer.phone, 64);
    const gstin = s(customer.gstin, 32)?.toUpperCase() || null;
    const pan = s(customer.pan, 32)?.toUpperCase() || null;
    const contactId = s(customer.contact_id, 36);
    const companyId = s(customer.company_id, 36);

    if (found) {
      await db.execute(
        `UPDATE invoice_bill_to_addresses
            SET \`name\`       = COALESCE(NULLIF(\`name\`, ''), ?),
                company       = COALESCE(NULLIF(company, ''), ?),
                phone         = COALESCE(NULLIF(phone, ''), ?),
                gstin         = COALESCE(NULLIF(gstin, ''), ?),
                pan           = COALESCE(NULLIF(pan, ''), ?),
                address_line1 = COALESCE(NULLIF(address_line1, ''), ?),
                address_line2 = COALESCE(NULLIF(address_line2, ''), ?),
                contact_id    = COALESCE(NULLIF(contact_id, ''), ?),
                company_id    = COALESCE(NULLIF(company_id, ''), ?),
                last_used_at  = NOW()
          WHERE user_id = ? AND id = ?`,
        [name, company, phone, gstin, pan, line1, line2, contactId, companyId, userId, found.id]
      );
      return;
    }

    await db.execute(
      `INSERT INTO invoice_bill_to_addresses
         (id, user_id, \`label\`, \`name\`, company, email, phone, gstin, pan,
          address_line1, address_line2, country, contact_id, company_id, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'India', ?, ?, NOW())`,
      [
        randomUUID(), userId, label, name, company, email, phone, gstin, pan,
        line1, line2, contactId, companyId,
      ]
    );
  } catch (e) {
    console.warn("[bill-to] could not save the customer to the address book", e);
  }
}

/**
 * What an invoice does to the address book once it is safely saved: mark the
 * picked address as used, or — when the customer was typed in by hand — add
 * them so the next invoice can just pick their email.
 *
 * Never throws: an invoice that exists must not be reported as failed because
 * its address book entry could not be written.
 */
export async function recordInvoiceBillTo(
  userId: string,
  billToId: string | null | undefined,
  customer: CapturedCustomer
): Promise<void> {
  const id = s(billToId, 36);
  if (id) {
    try {
      await touchBillTo(userId, id);
      return;
    } catch (e) {
      console.warn("[bill-to] could not mark the saved address as used", e);
      return;
    }
  }
  await captureBillTo(userId, customer);
}
