import { HttpError } from "./auth";
import { COMPANY_TEXT_FIELDS } from "./companyProfiles";
import { saveInvoiceFile } from "./invoiceUpload";
import type { CompanyProfileWrite } from "./companyProfilesRepo";

/**
 * Turn the multipart body the settings form posts into a company write.
 *
 * Logo and signature are only included when a new file was actually uploaded,
 * so saving the text fields never wipes an image that is already there.
 */
export async function readCompanyForm(
  form: FormData,
  opts: { partial?: boolean } = {}
): Promise<CompanyProfileWrite> {
  const values: Record<string, string | null> = {};
  for (const f of COMPANY_TEXT_FIELDS) {
    // A partial write (PATCH) touches only the fields it sends; a create fills
    // every column so the row starts in a known state.
    if (opts.partial && !form.has(f)) continue;
    const v = form.get(f);
    values[f] = v === null || v === undefined || v instanceof File
      ? null
      : String(v).trim().slice(0, 4000) || null;
  }

  // A company with no name at all is unpickable in the invoice form's list.
  // On a partial write only what was actually sent can be judged: clearing
  // both names at once is refused, clearing neither is fine.
  const sentNames = (["label", "seller_company"] as const).filter((k) => k in values);
  const anyNamed = sentNames.some((k) => String(values[k] || "").trim());
  if (opts.partial ? sentNames.length === 2 && !anyNamed : !anyNamed) {
    throw new HttpError(400, "Give the company a name.");
  }

  const write: CompanyProfileWrite = { values };

  const logo = form.get("logo");
  if (logo instanceof File && logo.size > 0) {
    const saved = await saveInvoiceFile(logo, { allow: ["image/"], maxBytes: 5 * 1024 * 1024 });
    if ("error" in saved) throw new HttpError(400, `Logo: ${saved.error}`);
    write.logo_path = saved.file_path;
  }
  const sig = form.get("signature");
  if (sig instanceof File && sig.size > 0) {
    const saved = await saveInvoiceFile(sig, { allow: ["image/"], maxBytes: 5 * 1024 * 1024 });
    if ("error" in saved) throw new HttpError(400, `Signature: ${saved.error}`);
    write.signature_path = saved.file_path;
  }

  return write;
}
