import { NextResponse } from "next/server";
import { getUser, HttpError } from "@/lib/auth";
import { listCompanyProfiles, createCompanyProfile } from "@/lib/companyProfilesRepo";
import { readCompanyForm } from "@/lib/companyProfileForm";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ---- GET: every company this user can invoice as, default first ----
export async function GET() {
  const session = await getUser();
  if (!session) return NextResponse.json({ data: [] }, { status: 401 });
  return NextResponse.json({ data: await listCompanyProfiles(session.id) });
}

// ---- POST: add a company (multipart, so it can carry a logo/signature) ----
export async function POST(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Expected form data" }, { status: 400 });

  try {
    const company = await createCompanyProfile(session.id, await readCompanyForm(form));
    return NextResponse.json({ company }, { status: 201 });
  } catch (e: any) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[companies] create failed", e);
    return NextResponse.json({ error: "Could not save the company. Please try again." }, { status: 500 });
  }
}
