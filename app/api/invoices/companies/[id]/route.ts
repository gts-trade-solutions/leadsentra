import { NextResponse } from "next/server";
import { getUser, HttpError } from "@/lib/auth";
import {
  getCompanyProfile,
  updateCompanyProfile,
  deleteCompanyProfile,
  setDefaultCompanyProfile,
} from "@/lib/companyProfilesRepo";
import { readCompanyForm } from "@/lib/companyProfileForm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ---- GET: one company ----
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const company = await getCompanyProfile(session.id, params.id);
  if (!company) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ company });
}

/**
 * ---- PATCH: edit a company ----
 *
 * Multipart, like the create: only the fields sent are written, and the logo
 * or signature only changes when a new file comes with it.
 *
 * Sending is_default=1 makes this the company invoices fall back to; that is
 * accepted on its own, without any other field.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Expected form data" }, { status: 400 });

  try {
    const write = await readCompanyForm(form, { partial: true });
    let company = await updateCompanyProfile(session.id, params.id, write);
    if (String(form.get("is_default") || "") === "1") {
      await setDefaultCompanyProfile(session.id, params.id);
      company = (await getCompanyProfile(session.id, params.id))!;
    }
    return NextResponse.json({ company });
  } catch (e: any) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[companies] update failed", e);
    return NextResponse.json({ error: "Could not update the company. Please try again." }, { status: 500 });
  }
}

// ---- DELETE: drop a company ----
// Invoices already issued carry their own snapshot of the seller, so nothing
// that has gone out changes.
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const removed = await deleteCompanyProfile(session.id, params.id);
  if (!removed) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
