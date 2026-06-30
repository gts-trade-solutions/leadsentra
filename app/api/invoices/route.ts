import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser, HttpError } from "@/lib/auth";
import { createProformaInvoice } from "@/lib/invoiceCreate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// ---- GET: list this user's invoices ----
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
    `SELECT id, invoice_number, status, source, customer_name, customer_company, customer_email,
            currency, total,
            DATE_FORMAT(issue_date, '%Y-%m-%d') AS issue_date,
            DATE_FORMAT(valid_until, '%Y-%m-%d') AS valid_until,
            sent_at, created_at
       FROM proforma_invoices
      WHERE ${where.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT ${limit}`,
    params
  );
  return NextResponse.json({ data: rows });
}

// ---- POST: create a draft invoice ----
export async function POST(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  try {
    const created = await createProformaInvoice(session.id, session.email, body);
    return NextResponse.json(created, { status: 201 });
  } catch (e: any) {
    if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[invoices] create failed", e);
    return NextResponse.json({ error: "Could not create invoice. Please try again." }, { status: 500 });
  }
}
