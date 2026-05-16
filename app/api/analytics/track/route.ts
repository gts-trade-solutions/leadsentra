import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const user = await requireUser();
  const body = await req.json().catch(() => ({}));
  const provider = String(body.provider || "app");
  const event_type = String(body.event_type || "").trim();
  const payload = body.payload ?? null;

  if (!event_type) {
    return NextResponse.json(
      { ok: false, error: "event_type required" },
      { status: 400 }
    );
  }

  try {
    await db.execute(
      `INSERT INTO analytics_events (user_id, provider, event_type, meta)
       VALUES (?, ?, ?, CAST(? AS JSON))`,
      [user.id, provider, event_type, JSON.stringify(payload ?? {})]
    );
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Insert failed" },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true });
}
