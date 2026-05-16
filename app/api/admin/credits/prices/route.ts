import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const gate = await requireRole("staff");
  if ("response" in gate) return gate.response;

  const [rows] = await db.execute(
    "SELECT feature, price FROM credits_prices ORDER BY feature"
  );
  return NextResponse.json({ prices: rows });
}

/**
 * Admin-only bulk price update.
 * Body: { prices: [{ feature, price }, ...] }
 */
export async function PATCH(req: Request) {
  const gate = await requireRole("admin");
  if ("response" in gate) return gate.response;

  const body = await req.json().catch(() => ({}));
  const items: any[] = Array.isArray(body?.prices) ? body.prices : [];
  if (!items.length) {
    return NextResponse.json({ error: "No prices to update" }, { status: 400 });
  }

  const cleaned = items
    .map((it) => ({
      feature: String(it.feature || "").trim(),
      price: Number(it.price),
    }))
    .filter((it) => it.feature && Number.isFinite(it.price) && it.price >= 0);

  if (!cleaned.length) {
    return NextResponse.json({ error: "No valid rows" }, { status: 400 });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    for (const it of cleaned) {
      await conn.execute(
        `INSERT INTO credits_prices (feature, price) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE price = VALUES(price)`,
        [it.feature, Math.floor(it.price)]
      );
    }
    await conn.commit();
  } catch (e: any) {
    await conn.rollback();
    return NextResponse.json({ error: e?.message || "Update failed" }, { status: 500 });
  } finally {
    conn.release();
  }

  return NextResponse.json({ ok: true, updated: cleaned.length });
}
