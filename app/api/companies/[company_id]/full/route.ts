import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { isStaff } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: { company_id: string } }
) {
  const session = await getUser();
  if (!session) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const company_id = decodeURIComponent(params.company_id);
  const staffBypass = isStaff(session.role);

  const [companyRows] = await db.execute(
    `SELECT company_id, company_name, legal_name, trading_name, company_type, segment, size, website,
            head_office_address, city_regency, country, postal_code, phone_main, email_general,
            linkedin, notes, company_profile, financial_reports, forecast_value, meta
       FROM companies
      WHERE company_id = ?
      LIMIT 1`,
    [company_id]
  );
  const company = (companyRows as any[])[0] ?? null;

  // Departments are stored as a JSON array under meta.departments.
  let departments: string[] = [];
  if (company?.meta) {
    try {
      const m = typeof company.meta === "string" ? JSON.parse(company.meta) : company.meta;
      if (Array.isArray(m?.departments)) {
        departments = m.departments.filter((d: unknown): d is string => typeof d === "string");
      }
    } catch {
      /* malformed meta — treat as no departments */
    }
  }

  const [contactRows] = await db.execute(
    `SELECT id, contact_name, title, department, email, phone,
            linkedin_url, facebook_url, instagram_url, notes
       FROM contacts
      WHERE company_id = ?`,
    [company_id]
  );
  const contacts = contactRows as any[];

  // Staff treat everything as unlocked.  For regular users we look up the
  // contacts_unlocks / company_assets_unlocks state.
  let unlockedIds = new Set<string>();
  let assets = {
    financials_unlocked: false,
    forecast_unlocked: false,
    mgmt_pack_unlocked: false,
  };

  if (staffBypass) {
    unlockedIds = new Set(contacts.map((c) => c.id as string));
    assets = {
      financials_unlocked: true,
      forecast_unlocked: true,
      mgmt_pack_unlocked: true,
    };
  } else {
    if (contacts.length) {
      const ids = contacts.map((c) => c.id);
      const placeholders = ids.map(() => "?").join(",");
      const [unlockedRows] = await db.query(
        `SELECT contact_id FROM contacts_unlocks
          WHERE user_id = ? AND contact_id IN (${placeholders})`,
        [session.id, ...ids]
      );
      unlockedIds = new Set((unlockedRows as any[]).map((r) => r.contact_id as string));
    }
    const [assetRows] = await db.execute(
      `SELECT asset FROM company_assets_unlocks
        WHERE user_id = ? AND company_id = ?`,
      [session.id, company_id]
    );
    const assetSet = new Set((assetRows as any[]).map((r) => r.asset as string));
    assets = {
      financials_unlocked: assetSet.has("financials"),
      forecast_unlocked: assetSet.has("forecast"),
      mgmt_pack_unlocked: assetSet.has("mgmt_pack"),
    };
  }

  // Return all contacts the caller is allowed to see (staff: all; user: their unlocked set).
  const contacts_unlocked = contacts.filter((c) => unlockedIds.has(c.id));

  // Mask sensitive company fields if the corresponding asset isn't unlocked.
  const company_out = company
    ? (() => {
        const { meta: _meta, ...rest } = company as any;
        return {
          ...rest,
          departments,
          financial_reports: assets.financials_unlocked ? company.financial_reports : null,
          forecast_value: assets.forecast_unlocked ? company.forecast_value : null,
        };
      })()
    : null;

  return NextResponse.json({
    company: company_out,
    assets,
    contacts: contacts_unlocked,
    counts: { total: contacts.length, unlocked: contacts_unlocked.length },
  });
}
