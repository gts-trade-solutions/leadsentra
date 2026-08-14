import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { cleanDepartments } from "@/lib/departments";
import { cleanPhone, cleanUrl, type CleanResult } from "@/lib/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function fetchOwned(id: string, userId: string, isAdmin: boolean) {
  const sql = isAdmin
    ? "SELECT * FROM companies WHERE company_id = ? LIMIT 1"
    : "SELECT * FROM companies WHERE company_id = ? AND (user_id = ? OR user_id IS NULL) LIMIT 1";
  const params = isAdmin ? [id] : [id, userId];
  const [rows] = await db.execute(sql, params);
  return (rows as any[])[0] || null;
}

export async function PATCH(req: Request, { params }: { params: { company_id: string } }) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const existing = await fetchOwned(params.company_id, session.id, session.role === "admin");
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.user_id && existing.user_id !== session.id && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const sets: string[] = [];
  const vals: any[] = [];

  // Direct column updates.
  const map: Record<string, string> = {
    name: "company_name",
    type: "industry",
    segment: "segment",
    size: "size",
    website: "website",
    linkedin: "linkedin",
    facebook_url: "facebook_url",
    instagram_url: "instagram_url",
    country: "country",
    // City/regency lives on its own direct column; the UI calls it "Region".
    region: "city_regency",
    city_regency: "city_regency",
    // Main contact phone for the company.
    phone: "phone_main",
    phone_main: "phone_main",
    // email_general is a real column and always has been — the export reads it
    // from there. It was listed under the meta-JSON keys below, so editing a
    // company's general email wrote to meta.email_general, which nothing reads:
    // the value appeared to save and then silently didn't change.
    email_general: "email_general",
    // Additional contact points. One inbox and one switchboard was never
    // enough — the extras used to end up in the notes field.
    email_general_2: "email_general_2",
    email_general_3: "email_general_3",
    phone_main_2: "phone_main_2",
    phone_main_3: "phone_main_3",
    // These are all real columns — the company details modal, the export and
    // the importer all read them from there. They were listed under the
    // meta-JSON keys below, so an edit wrote to meta.<field> where nothing
    // reads it: the value looked saved and silently wasn't. Same defect that
    // affected email_general.
    legal_name: "legal_name",
    trading_name: "trading_name",
    head_office_address: "head_office_address",
    postal_code: "postal_code",
    notes: "notes",
    company_profile: "company_profile",
    financial_reports: "financial_reports",
  };

  // Phone / URL fields go through the shared cleaner: placeholder junk
  // ("not provided", "n/a", …) saves as NULL, malformed values 400.
  const cleaners: Record<string, (v: any) => CleanResult> = {
    website: (v) => cleanUrl(v, undefined, "Website URL"),
    linkedin: (v) => cleanUrl(v, "linkedin", "LinkedIn URL"),
    facebook_url: (v) => cleanUrl(v, "facebook", "Facebook URL"),
    instagram_url: (v) => cleanUrl(v, "instagram", "Instagram URL"),
    phone: (v) => cleanPhone(v),
    phone_main: (v) => cleanPhone(v),
    phone_main_2: (v) => cleanPhone(v),
    phone_main_3: (v) => cleanPhone(v),
  };

  for (const [key, col] of Object.entries(map)) {
    if (key in body) {
      const v = typeof body[key] === "string" ? body[key].trim() : body[key];
      if (cleaners[key]) {
        const cleaned = cleaners[key](v);
        if (cleaned.error) {
          return NextResponse.json({ error: cleaned.error }, { status: 400 });
        }
        sets.push(`${col} = ?`);
        vals.push(cleaned.value);
        continue;
      }
      sets.push(`${col} = ?`);
      vals.push(v === "" ? null : v);
    }
  }

  // forecast_value is DECIMAL — coerce it rather than writing whatever the
  // form's text input produced, and let an empty box clear it.
  if ("forecast_value" in body) {
    const raw = String((body as any).forecast_value ?? "").trim();
    if (raw === "") {
      sets.push("forecast_value = ?");
      vals.push(null);
    } else {
      const n = Number(raw.replace(/,/g, ""));
      if (!Number.isFinite(n)) {
        return NextResponse.json({ error: "Forecast value must be a number." }, { status: 400 });
      }
      sets.push("forecast_value = ?");
      vals.push(n);
    }
  }

  // Meta JSON updates. Only `departments` genuinely belongs here — everything
  // else that used to be in this list has a real column and moved to the map
  // above.
  const metaPairs: string[] = [];
  const metaVals: any[] = [];
  // Departments live as a JSON array under meta.departments. We accept an
  // empty array too, so the user can clear every department on a company.
  if ("departments" in body) {
    metaPairs.push(`'$.departments', CAST(? AS JSON)`);
    metaVals.push(JSON.stringify(cleanDepartments((body as any).departments)));
  }
  if (metaPairs.length) {
    sets.push(`meta = JSON_SET(COALESCE(meta, JSON_OBJECT()), ${metaPairs.join(", ")})`);
    vals.push(...metaVals);
  }

  if (!sets.length) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  vals.push(params.company_id);
  await db.execute(`UPDATE companies SET ${sets.join(", ")} WHERE company_id = ?`, vals);

  const [rows] = await db.execute(
    "SELECT * FROM companies WHERE company_id = ? LIMIT 1",
    [params.company_id]
  );
  return NextResponse.json({ company: (rows as any[])[0] });
}

export async function DELETE(_req: Request, { params }: { params: { company_id: string } }) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const existing = await fetchOwned(params.company_id, session.id, session.role === "admin");
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.user_id && existing.user_id !== session.id && session.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [cnt] = await db.execute(
    "SELECT COUNT(*) AS c FROM contacts WHERE company_id = ?",
    [params.company_id]
  );
  const c = Number((cnt as any[])[0]?.c || 0);
  if (c > 0) {
    return NextResponse.json(
      { error: `Cannot delete: ${c} contact(s) still reference this company` },
      { status: 409 }
    );
  }

  await db.execute("DELETE FROM companies WHERE company_id = ?", [params.company_id]);
  return NextResponse.json({ ok: true });
}
