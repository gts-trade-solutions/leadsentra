import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { num, money } from "@/lib/invoices";
import { normalizeRoutes, nextOfferNumber, OFFER_DEFAULTS } from "@/lib/offers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function s(v: unknown, max = 255): string | null {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t ? t.slice(0, max) : null;
}

// ---- GET: list this user's offers ----
export async function GET(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ data: [] }, { status: 401 });

  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const limit = Math.min(Number(url.searchParams.get("limit") || 200), 1000);

  const where = ["user_id = ?"];
  const params: any[] = [session.id];
  if (status === "draft" || status === "sent") {
    where.push("status = ?");
    params.push(status);
  }

  const [rows] = await db.execute(
    `SELECT id, offer_number, status, source, customer_name, customer_company, customer_email,
            currency, total,
            DATE_FORMAT(issue_date, '%Y-%m-%d') AS issue_date,
            sent_at, created_at
       FROM offers
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT ${limit}`,
    params
  );
  return NextResponse.json({ data: rows });
}

// ---- POST: create a draft offer ----
export async function POST(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));

  const routes = normalizeRoutes(body.routes);
  if (!routes.length) {
    return NextResponse.json({ error: "Add at least one route." }, { status: 400 });
  }

  const customer = {
    contact_id: s(body.customer_contact_id, 36),
    company_id: s(body.customer_company_id, 36),
    company: s(body.customer_company),
    name: s(body.customer_name),
    email: s(body.customer_email),
    address: s(body.customer_address, 2000),
  };
  if (!customer.name && !customer.company) {
    return NextResponse.json({ error: "Recipient company or attention name is required." }, { status: 400 });
  }

  // Optional seller offer-number prefix.
  const [settingsRows] = await db.execute(
    "SELECT offer_prefix, invoice_prefix FROM invoice_settings WHERE user_id = ? LIMIT 1",
    [session.id]
  );
  const settings = (settingsRows as any[])[0] || null;

  const issueDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.issue_date || ""))
    ? String(body.issue_date)
    : new Date().toISOString().slice(0, 10);
  const year = Number(issueDate.slice(0, 4)) || new Date().getFullYear();

  const total = money(Math.max(0, num(body.total, 0)));
  const taxRate = Math.max(0, num(body.tax_rate, OFFER_DEFAULTS.tax_rate));
  const validityDays = Math.max(1, Math.round(num(body.validity_days, OFFER_DEFAULTS.validity_days)));
  const currency = (s(body.currency, 8) || "INR").toUpperCase();

  const fields = {
    salutation: s(body.salutation, 64) || OFFER_DEFAULTS.salutation,
    subject: s(body.subject, 4000),
    cargo_length: s(body.cargo_length, 64),
    cargo_weight: s(body.cargo_weight, 64),
    cargo_diameter: s(body.cargo_diameter, 64),
    survey_timeline: s(body.survey_timeline, 255) || OFFER_DEFAULTS.survey_timeline,
    delivery: s(body.delivery, 255) || OFFER_DEFAULTS.delivery,
    payment_terms: s(body.payment_terms, 512) || OFFER_DEFAULTS.payment_terms,
    letter_signatory_name: s(body.letter_signatory_name) || OFFER_DEFAULTS.letter_signatory_name,
    letter_signatory_title: s(body.letter_signatory_title) || OFFER_DEFAULTS.letter_signatory_title,
    offer_signatory_name: s(body.offer_signatory_name) || OFFER_DEFAULTS.offer_signatory_name,
    offer_signatory_title: s(body.offer_signatory_title) || OFFER_DEFAULTS.offer_signatory_title,
    notes: s(body.notes, 4000),
  };

  const id = randomUUID();
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Use the typed quote number if given; otherwise allocate one.
    const explicit = s(body.offer_number, 96);
    const offerNumber = explicit || (await nextOfferNumber(conn, session.id, year, settings?.offer_prefix || settings?.invoice_prefix));

    await conn.execute(
      `INSERT INTO offers
        (id, user_id, offer_number, status, source, template_id,
         customer_contact_id, customer_company_id, customer_company, customer_name, customer_email, customer_address,
         salutation, subject, cargo_length, cargo_weight, cargo_diameter,
         survey_timeline, delivery, currency, tax_rate, total, payment_terms, validity_days,
         letter_signatory_name, letter_signatory_title, offer_signatory_name, offer_signatory_title,
         notes, issue_date)
       VALUES (?, ?, ?, 'draft', 'generated', ?,
         ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?,
         ?, ?, ?, ?, ?, ?, ?,
         ?, ?, ?, ?,
         ?, ?)`,
      [
        id, session.id, offerNumber, s(body.template_id, 36),
        customer.contact_id, customer.company_id, customer.company, customer.name, customer.email, customer.address,
        fields.salutation, fields.subject, fields.cargo_length, fields.cargo_weight, fields.cargo_diameter,
        fields.survey_timeline, fields.delivery, currency, taxRate, total, fields.payment_terms, validityDays,
        fields.letter_signatory_name, fields.letter_signatory_title, fields.offer_signatory_name, fields.offer_signatory_title,
        fields.notes, issueDate,
      ]
    );

    for (const r of routes) {
      await conn.execute(
        "INSERT INTO offer_routes (offer_id, position, route_text) VALUES (?, ?, ?)",
        [id, r.position, r.route_text]
      );
    }

    await conn.commit();
    return NextResponse.json({ id, offer_number: offerNumber }, { status: 201 });
  } catch (e: any) {
    await conn.rollback();
    if (e?.code === "ER_DUP_ENTRY") {
      return NextResponse.json({ error: "That quote number already exists. Use a different one." }, { status: 409 });
    }
    console.error("[offers] create failed", e);
    return NextResponse.json({ error: "Could not create offer. Please try again." }, { status: 500 });
  } finally {
    conn.release();
  }
}
