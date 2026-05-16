import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Pricing (mirrors supabase/functions/payments/index.ts)
const USD_PER_CREDIT = 0.10;
const FX_INR_PER_USD = 88;
const PRO_QTY = 3000;
const PREMIUM_QTY = 7200;
const PRO_DISCOUNT = 0.15;
const PREMIUM_DISCOUNT = 0.25;

function buildReceipt(userId: string) {
  const uid = userId.replace(/-/g, "").slice(0, 8);
  const t = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `rcpt_${uid}_${t}_${rand}`.slice(0, 40);
}

export async function POST(req: Request) {
  const session = await getUser();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const RZP_KEY_ID = process.env.RAZORPAY_KEY_ID;
  const RZP_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
  if (!RZP_KEY_ID || !RZP_KEY_SECRET) {
    return NextResponse.json(
      { error: "Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET." },
      { status: 500 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const credits = Number(body.credits || 0);
  const profile = body.profile || {};

  if (!Number.isFinite(credits) || credits < 100) {
    return NextResponse.json({ error: "credits must be at least 100" }, { status: 400 });
  }

  // Upsert billing profile (one row per user)
  await db.execute(
    `INSERT INTO billing_profiles
       (user_id, full_name, email, phone, company, gstin, address)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       full_name = VALUES(full_name),
       email     = VALUES(email),
       phone     = VALUES(phone),
       company   = VALUES(company),
       gstin     = VALUES(gstin),
       address   = VALUES(address),
       updated_at = CURRENT_TIMESTAMP`,
    [
      session.id,
      profile.full_name ?? null,
      profile.email ?? session.email,
      profile.phone ?? null,
      profile.company ?? null,
      profile.gstin ?? null,
      profile.address ? JSON.stringify(profile.address) : null,
    ]
  );

  // Pricing
  let discount = 0;
  if (credits === PRO_QTY) discount = PRO_DISCOUNT;
  if (credits === PREMIUM_QTY) discount = PREMIUM_DISCOUNT;
  const totalInr = credits * USD_PER_CREDIT * (1 - discount) * FX_INR_PER_USD;
  const amountPaise = Math.max(1000, Math.round(totalInr * 100));

  // Create Razorpay order
  const auth = "Basic " + Buffer.from(`${RZP_KEY_ID}:${RZP_KEY_SECRET}`).toString("base64");
  const receipt = buildReceipt(session.id);

  let order: any;
  try {
    const r = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: auth },
      body: JSON.stringify({
        amount: amountPaise,
        currency: "INR",
        receipt,
        notes: { user_id: session.id, credits: String(credits) },
      }),
    });
    const text = await r.text();
    if (!r.ok) {
      return NextResponse.json(
        { error: "Razorpay order create failed", detail: text },
        { status: 500 }
      );
    }
    order = JSON.parse(text);
  } catch (e: any) {
    return NextResponse.json(
      { error: "Razorpay request failed", detail: e?.message || String(e) },
      { status: 500 }
    );
  }

  // Record 'created'
  const id = randomUUID();
  await db.execute(
    `INSERT INTO payments
       (id, user_id, razorpay_order_id, razorpay_payment_id,
        status, credits, amount_inr_paise, meta)
     VALUES (?, ?, ?, NULL, 'created', ?, ?, CAST(? AS JSON))`,
    [id, session.id, order.id, credits, amountPaise, JSON.stringify(order)]
  );

  return NextResponse.json({
    key_id: RZP_KEY_ID,
    order_id: order.id,
    amount: amountPaise,
    currency: "INR",
    credits,
  });
}
