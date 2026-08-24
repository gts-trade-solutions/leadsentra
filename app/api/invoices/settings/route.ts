import { NextResponse } from "next/server";
import { getUser, HttpError } from "@/lib/auth";
import {
  getDefaultCompanyProfile,
  createCompanyProfile,
  updateCompanyProfile,
} from "@/lib/companyProfilesRepo";
import { readCompanyForm } from "@/lib/companyProfileForm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The user's DEFAULT company, in the shape this endpoint has always returned.
 *
 * A user can now hold several companies (see /api/invoices/companies); this
 * route stays as the "my invoice settings" view of the default one, which for
 * a user with a single company is the same row it always was.
 */
export async function GET() {
  const session = await getUser();
  if (!session) return NextResponse.json({ settings: null }, { status: 401 });
  return NextResponse.json({ settings: await getDefaultCompanyProfile(session.id) });
}

// ---- POST: save the default company (creating it on first save) ----
export async function POST(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Expected form data" }, { status: 400 });

  try {
    // Partial: this form has never sent `label`, and a blank one must not
    // wipe the name the company is picked by in the invoice form.
    const write = await readCompanyForm(form, { partial: true });
    const current = await getDefaultCompanyProfile(session.id);
    const settings = current
      ? await updateCompanyProfile(session.id, current.id, write)
      : await createCompanyProfile(session.id, {
          ...write,
          values: {
            ...write.values,
            label: write.values.label || write.values.seller_company || "My company",
          },
        });
    return NextResponse.json({ ok: true, settings });
  } catch (e: any) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[invoice-settings] save failed", e);
    return NextResponse.json({ error: "Could not save the settings. Please try again." }, { status: 500 });
  }
}
