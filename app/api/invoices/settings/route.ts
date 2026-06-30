import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { saveInvoiceFile } from "@/lib/invoiceUpload";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TEXT_FIELDS = [
  "seller_company",
  "seller_address",
  "gstin",
  "pan",
  "email",
  "phone",
  "bank_name",
  "bank_account",
  "bank_branch",
  "bank_ifsc",
  "payment_terms",
  "delivery_terms",
  "declaration",
  "signatory_name",
  "invoice_prefix",
] as const;

export async function GET() {
  const session = await getUser();
  if (!session) return NextResponse.json({ settings: null }, { status: 401 });
  const [rows] = await db.execute(
    "SELECT * FROM invoice_settings WHERE user_id = ? LIMIT 1",
    [session.id]
  );
  return NextResponse.json({ settings: (rows as any[])[0] || null });
}

export async function POST(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Expected form data" }, { status: 400 });

  const values: Record<string, string | null> = {};
  for (const f of TEXT_FIELDS) {
    const v = form.get(f);
    values[f] = v === null || v === undefined ? null : String(v).trim().slice(0, 4000) || null;
  }

  // Optional image uploads — only overwrite the stored path when a new file is
  // actually supplied (so saving text fields doesn't wipe an existing logo).
  let logoPath: string | undefined;
  let signaturePath: string | undefined;
  const logo = form.get("logo");
  if (logo && logo instanceof File && logo.size > 0) {
    const saved = await saveInvoiceFile(logo, { allow: ["image/"], maxBytes: 5 * 1024 * 1024 });
    if ("error" in saved) return NextResponse.json({ error: `Logo: ${saved.error}` }, { status: 400 });
    logoPath = saved.file_path;
  }
  const sig = form.get("signature");
  if (sig && sig instanceof File && sig.size > 0) {
    const saved = await saveInvoiceFile(sig, { allow: ["image/"], maxBytes: 5 * 1024 * 1024 });
    if ("error" in saved) return NextResponse.json({ error: `Signature: ${saved.error}` }, { status: 400 });
    signaturePath = saved.file_path;
  }

  // Build an upsert. logo/signature only included when newly uploaded.
  const cols = [...TEXT_FIELDS] as string[];
  const params: any[] = TEXT_FIELDS.map((f) => values[f]);
  if (logoPath !== undefined) {
    cols.push("logo_path");
    params.push(logoPath);
  }
  if (signaturePath !== undefined) {
    cols.push("signature_path");
    params.push(signaturePath);
  }

  const insertCols = ["user_id", ...cols].join(", ");
  const placeholders = ["?", ...cols.map(() => "?")].join(", ");
  const updates = cols.map((c) => `${c} = VALUES(${c})`).join(", ");

  await db.execute(
    `INSERT INTO invoice_settings (${insertCols}) VALUES (${placeholders})
     ON DUPLICATE KEY UPDATE ${updates}`,
    [session.id, ...params]
  );

  const [rows] = await db.execute("SELECT * FROM invoice_settings WHERE user_id = ? LIMIT 1", [session.id]);
  return NextResponse.json({ ok: true, settings: (rows as any[])[0] || null });
}
