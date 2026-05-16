import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import {
  SuppressionType,
  isDomainShape,
  isEmailShape,
  normalizeDomain,
} from "@/lib/suppressions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ALLOWED_SOURCES = new Set([
  "manual",
  "bounce",
  "complaint",
  "unsubscribe",
  "import",
]);

export async function GET(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const type = url.searchParams.get("type");   // 'email' | 'domain' | null
  const source = url.searchParams.get("source"); // optional source filter
  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const limit = Math.min(Math.max(1, Number(url.searchParams.get("limit") || 50)), 500);
  const offset = (page - 1) * limit;

  // `corrected` query param:
  //   "true"  -> only corrected rows
  //   "false" -> only active (not corrected) rows  ← what "Bounce/Complaint/..." should mean
  //   anything else (omitted / "all") -> no filter
  const correctedParam = (url.searchParams.get("corrected") || "").toLowerCase();

  const where: string[] = ["user_id = ?"];
  const params: any[] = [session.id];
  if (type === "email" || type === "domain") {
    where.push("type = ?");
    params.push(type);
  }
  if (source && ALLOWED_SOURCES.has(source)) {
    where.push("source = ?");
    params.push(source);
  }
  if (correctedParam === "true") {
    where.push("corrected = 1");
  } else if (correctedParam === "false") {
    where.push("(corrected IS NULL OR corrected = 0)");
  }
  if (q) {
    where.push("(value LIKE ? OR reason LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }
  const whereSql = where.join(" AND ");

  const [rows] = await db.query(
    `SELECT id, type, value, reason, source, corrected, corrected_at, created_at
       FROM suppressions
      WHERE ${whereSql}
      ORDER BY created_at DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params
  );

  const [[totalRow]] = await db.query(
    `SELECT COUNT(*) AS total FROM suppressions WHERE ${whereSql}`,
    params
  ) as any;
  const total = Number((totalRow as any)?.total || 0);

  // Summary counts (unfiltered, per user)
  const [countRows] = await db.execute(
    `SELECT
       SUM(1)                                       AS total,
       SUM(CASE WHEN type   = 'email'  THEN 1 ELSE 0 END) AS emails,
       SUM(CASE WHEN type   = 'domain' THEN 1 ELSE 0 END) AS domains,
       SUM(CASE WHEN source = 'manual' THEN 1 ELSE 0 END) AS manual
     FROM suppressions WHERE user_id = ?`,
    [session.id]
  );
  const s = (countRows as any[])[0] || {};

  return NextResponse.json({
    rows,
    page,
    limit,
    total,
    summary: {
      total:   Number(s.total   || 0),
      emails:  Number(s.emails  || 0),
      domains: Number(s.domains || 0),
      manual:  Number(s.manual  || 0),
    },
  });
}

type Entry = {
  type?: string;
  value: string;
  reason?: string | null;
  source?: string;
};

/**
 * Accepts either:
 *   single:  { type, value, reason?, source? }
 *   bulk:    { entries: [{ type, value, reason?, source? }, ...] }
 *
 * Each entry is validated independently.  Duplicates are silently skipped
 * (INSERT IGNORE under the hood) so a paste of overlapping addresses is safe.
 */
export async function POST(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const isBulk = Array.isArray(body?.entries);
  const inputs: Entry[] = isBulk ? body.entries : [body];

  const accepted: Array<{ type: SuppressionType; value: string; reason: string | null; source: string }> = [];
  const skipped: Array<{ value: string; error: string }> = [];

  for (const raw of inputs) {
    const valueIn = String(raw?.value || "").trim().toLowerCase();
    if (!valueIn) {
      skipped.push({ value: "", error: "missing value" });
      continue;
    }

    // Auto-detect type if not supplied: presence of "@" → email, else domain
    const declared = String(raw?.type || "").toLowerCase().trim();
    const type: SuppressionType =
      declared === "email" || declared === "domain"
        ? (declared as SuppressionType)
        : valueIn.includes("@") ? "email" : "domain";

    const value = type === "domain" ? normalizeDomain(valueIn) : valueIn;

    if (type === "email" && !isEmailShape(value)) {
      skipped.push({ value, error: "invalid email" });
      continue;
    }
    if (type === "domain" && !isDomainShape(value)) {
      skipped.push({ value, error: "invalid domain" });
      continue;
    }

    const source = String(raw?.source || "manual").toLowerCase();
    if (!ALLOWED_SOURCES.has(source)) {
      skipped.push({ value, error: "invalid source" });
      continue;
    }

    const reason = raw?.reason ? String(raw.reason).trim().slice(0, 255) : null;
    accepted.push({ type, value, reason, source });
  }

  if (!accepted.length) {
    if (isBulk) {
      return NextResponse.json(
        { added: 0, skipped, error: "No valid entries" },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { error: skipped[0]?.error || "Invalid input" },
      { status: 400 }
    );
  }

  // Bulk insert with INSERT IGNORE — duplicates (unique on user_id,type,value) silently skip
  const values: any[] = [];
  const placeholders: string[] = [];
  for (const e of accepted) {
    placeholders.push("(?, ?, ?, ?, ?)");
    values.push(session.id, e.type, e.value, e.reason, e.source);
  }
  const [result] = await db.query(
    `INSERT IGNORE INTO suppressions (user_id, type, value, reason, source)
     VALUES ${placeholders.join(",")}`,
    values
  );
  const added = (result as any)?.affectedRows ?? 0;
  const duplicates = accepted.length - added;

  if (!isBulk) {
    if (added === 0) {
      return NextResponse.json(
        { error: `${accepted[0].type === "email" ? "Email" : "Domain"} already suppressed` },
        { status: 409 }
      );
    }
    return NextResponse.json(accepted[0], { status: 201 });
  }

  return NextResponse.json({
    added,
    duplicates,
    skipped,
    parsed: inputs.length,
  });
}
