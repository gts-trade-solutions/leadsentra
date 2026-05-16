import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { isStaff } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Pricing v2: prices come from the `credits_prices` table.  Defaults below
// only apply if the row is missing (e.g. fresh DB without seed).
const PRICE_FEATURE: Record<string, { feature: string; fallback: number }> = {
  financials: { feature: "asset_financials", fallback: 10 },
  forecast:   { feature: "asset_forecast",   fallback: 10 },
  mgmt_pack:  { feature: "asset_mgmt_pack",  fallback: 25 },
};
const VALID_SINGLE_ASSETS = new Set(["financials", "forecast"]);

async function getBalance(userId: string): Promise<number> {
  const [rows] = await db.execute(
    "SELECT balance FROM credits_wallets WHERE user_id = ? LIMIT 1",
    [userId]
  );
  return Number((rows as any[])[0]?.balance ?? 0);
}

async function lookupPrice(asset: string): Promise<number> {
  const meta = PRICE_FEATURE[asset];
  if (!meta) return 0;
  const [rows] = await db.execute(
    "SELECT price FROM credits_prices WHERE feature = ? LIMIT 1",
    [meta.feature]
  );
  const p = Number((rows as any[])[0]?.price);
  return Number.isFinite(p) && p >= 0 ? p : meta.fallback;
}

export async function POST(req: Request) {
  const session = await getUser();
  if (!session) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const company_id = body?.company_id;
  const type = body?.type;
  if (!company_id || !type) {
    return NextResponse.json({ error: "Missing company_id or type" }, { status: 400 });
  }

  const staffBypass = isStaff(session.role);

  if (type === "financials" || type === "forecast") {
    return unlockSingleAsset(session.id, company_id, type, staffBypass);
  }
  if (type === "mgmt_pack") {
    return unlockMgmtPack(session.id, company_id, staffBypass);
  }
  return NextResponse.json({ error: "Invalid type" }, { status: 400 });
}

async function unlockSingleAsset(userId: string, companyId: string, asset: string, staffBypass: boolean) {
  if (!VALID_SINGLE_ASSETS.has(asset)) {
    return NextResponse.json({ error: "Invalid type" }, { status: 400 });
  }

  // Already unlocked? No-op return.
  const [existing] = await db.execute(
    `SELECT 1 FROM company_assets_unlocks
      WHERE user_id = ? AND company_id = ? AND asset = ?
      LIMIT 1`,
    [userId, companyId, asset]
  );
  if ((existing as any[]).length) {
    const balance = await getBalance(userId);
    return NextResponse.json({ ok: true, message: `Already unlocked: ${asset}`, balance });
  }

  // Staff bypass: insert unlock row directly, skip wallet debit + ledger.
  if (staffBypass) {
    await db.execute(
      `INSERT IGNORE INTO company_assets_unlocks (user_id, company_id, asset)
       VALUES (?, ?, ?)`,
      [userId, companyId, asset]
    );
    return NextResponse.json({
      ok: true,
      message: `Unlocked ${asset} (staff bypass)`,
      balance: await getBalance(userId),
      charged: 0,
      staff_bypass: true,
    });
  }

  const price = await lookupPrice(asset);

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [walletRows] = await conn.execute(
      "SELECT balance FROM credits_wallets WHERE user_id = ? FOR UPDATE",
      [userId]
    );
    const balance = Number((walletRows as any[])[0]?.balance ?? 0);
    if (balance < price) {
      await conn.rollback();
      return NextResponse.json(
        { error: "INSUFFICIENT_CREDITS", required: price, balance },
        { status: 400 }
      );
    }

    await conn.execute(
      "UPDATE credits_wallets SET balance = balance - ?, updated_at = NOW() WHERE user_id = ?",
      [price, userId]
    );
    await conn.execute(
      "UPDATE wallet SET balance = balance - ? WHERE user_id = ?",
      [price, userId]
    );
    await conn.execute(
      `INSERT INTO credits_ledger (user_id, delta, kind, correlation_id, note)
       VALUES (?, ?, 'debit', ?, ?)`,
      [userId, -price, `asset:${companyId}:${asset}`, `Unlock ${asset}`]
    );
    await conn.execute(
      `INSERT INTO company_assets_unlocks (user_id, company_id, asset)
       VALUES (?, ?, ?)`,
      [userId, companyId, asset]
    );

    await conn.commit();
    return NextResponse.json({
      ok: true,
      message: `Unlocked ${asset}`,
      balance: balance - price,
      charged: price,
    });
  } catch (e: any) {
    await conn.rollback();
    return NextResponse.json({ error: e?.message || "Unlock failed" }, { status: 500 });
  } finally {
    conn.release();
  }
}

async function unlockMgmtPack(userId: string, companyId: string, staffBypass: boolean) {
  // Already unlocked?
  const [existing] = await db.execute(
    `SELECT 1 FROM company_assets_unlocks
      WHERE user_id = ? AND company_id = ? AND asset = 'mgmt_pack'
      LIMIT 1`,
    [userId, companyId]
  );
  if ((existing as any[]).length) {
    const balance = await getBalance(userId);
    return NextResponse.json({ ok: true, message: "Already unlocked: mgmt_pack", balance });
  }

  // Staff bypass: skip wallet debit + ledger, still record unlocks.
  if (staffBypass) {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute(
        `INSERT IGNORE INTO company_assets_unlocks (user_id, company_id, asset)
         VALUES (?, ?, 'mgmt_pack')`,
        [userId, companyId]
      );
      const [unlockResult] = await conn.execute(
        `INSERT IGNORE INTO contacts_unlocks (user_id, contact_id)
         SELECT ?, id FROM contacts WHERE company_id = ?`,
        [userId, companyId]
      );
      await conn.execute(
        `INSERT IGNORE INTO unlocked_contacts (user_id, contact_id)
         SELECT ?, id FROM contacts WHERE company_id = ?`,
        [userId, companyId]
      );
      const unlockedCount = (unlockResult as any)?.affectedRows ?? 0;
      await conn.commit();
      return NextResponse.json({
        ok: true,
        message: `Unlocked management pack (${unlockedCount} contacts, staff bypass)`,
        balance: await getBalance(userId),
        unlocked_count: unlockedCount,
        charged: 0,
        staff_bypass: true,
      });
    } catch (e: any) {
      await conn.rollback();
      return NextResponse.json({ error: e?.message || "Unlock failed" }, { status: 500 });
    } finally {
      conn.release();
    }
  }

  const price = await lookupPrice("mgmt_pack");

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [walletRows] = await conn.execute(
      "SELECT balance FROM credits_wallets WHERE user_id = ? FOR UPDATE",
      [userId]
    );
    const balance = Number((walletRows as any[])[0]?.balance ?? 0);
    if (balance < price) {
      await conn.rollback();
      return NextResponse.json(
        { error: "INSUFFICIENT_CREDITS", required: price, balance },
        { status: 400 }
      );
    }

    await conn.execute(
      "UPDATE credits_wallets SET balance = balance - ?, updated_at = NOW() WHERE user_id = ?",
      [price, userId]
    );
    await conn.execute(
      "UPDATE wallet SET balance = balance - ? WHERE user_id = ?",
      [price, userId]
    );
    await conn.execute(
      `INSERT INTO credits_ledger (user_id, delta, kind, correlation_id, note)
       VALUES (?, ?, 'debit', ?, ?)`,
      [userId, -price, `mgmt_pack:${companyId}`, "Unlock mgmt pack"]
    );
    await conn.execute(
      `INSERT INTO company_assets_unlocks (user_id, company_id, asset)
       VALUES (?, ?, 'mgmt_pack')`,
      [userId, companyId]
    );

    // Bundle the management pack with full contact unlocks for this company
    const [unlockResult] = await conn.execute(
      `INSERT IGNORE INTO contacts_unlocks (user_id, contact_id)
       SELECT ?, id FROM contacts WHERE company_id = ?`,
      [userId, companyId]
    );
    await conn.execute(
      `INSERT IGNORE INTO unlocked_contacts (user_id, contact_id)
       SELECT ?, id FROM contacts WHERE company_id = ?`,
      [userId, companyId]
    );
    const unlockedCount = (unlockResult as any)?.affectedRows ?? 0;

    await conn.commit();
    return NextResponse.json({
      ok: true,
      message: `Unlocked management pack (${unlockedCount} contacts)`,
      balance: balance - price,
      unlocked_count: unlockedCount,
      charged: price,
    });
  } catch (e: any) {
    await conn.rollback();
    return NextResponse.json({ error: e?.message || "Unlock failed" }, { status: 500 });
  } finally {
    conn.release();
  }
}
