import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { isStaff } from "@/lib/admin";
import { saveCatalogueUpload } from "@/lib/catalogueUpload";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const norm = (v: unknown) =>
  typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : null;

const ALLOWED_KINDS = new Set(["catalogue", "offer"]);

/**
 * GET /api/catalogues
 *
 * Query params (all optional):
 *   company_id  show items tagged to this company (plus global items)
 *   department  show items tagged to this department (plus all-department items)
 *   kind        'catalogue' | 'offer'
 *
 * Filtering rule mirrors how the UI reads it: a saved item shows when its
 * company_id matches (or is NULL = "all companies") AND its department matches
 * (or is NULL = "all departments"). With no filters, returns the full library.
 */
export async function GET(req: NextRequest) {
  const session = await getUser();
  if (!session) return NextResponse.json({ items: [] }, { status: 401 });

  const url = new URL(req.url);
  const companyId = norm(url.searchParams.get("company_id"));
  const department = norm(url.searchParams.get("department"));
  const kind = norm(url.searchParams.get("kind"));
  // When true, restrict to items that apply to the given company/department.
  // When false (no company chosen), just return the whole owned/global library.
  const scoped = url.searchParams.get("scoped") === "1";

  const where: string[] = [];
  const params: any[] = [];

  // Visibility: staff see all; regular users see their own + global rows.
  if (!isStaff(session.role)) {
    where.push("(user_id = ? OR user_id IS NULL)");
    params.push(session.id);
  }

  if (scoped) {
    if (companyId) {
      where.push("(company_id = ? OR company_id IS NULL)");
      params.push(companyId);
    } else {
      // "All companies (overall)" chosen — only global items apply.
      where.push("company_id IS NULL");
    }
    if (department) {
      where.push("(department = ? OR department IS NULL)");
      params.push(department);
    }
  }
  if (kind && ALLOWED_KINDS.has(kind)) {
    where.push("kind = ?");
    params.push(kind);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [rows] = await db.query(
    `SELECT id, kind, title, subject, body, button_label, company_id, department,
            file_name, file_path, file_type, file_size, created_at
       FROM company_catalogues
       ${whereSql}
      ORDER BY created_at DESC`,
    params
  );

  return NextResponse.json({ items: rows });
}

/**
 * POST /api/catalogues  (multipart/form-data)
 *
 * Fields: kind, title, subject, body, company_id, department, file
 * Creates one catalogue/offer. `file` is optional; when present it's written
 * under public/uploads/catalogues and its public path is stored.
 */
export async function POST(req: NextRequest) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const fd = await req.formData().catch(() => null);
  if (!fd) return NextResponse.json({ error: "Expected form data" }, { status: 400 });

  const title = norm(fd.get("title"));
  if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });

  let kind = norm(fd.get("kind")) || "catalogue";
  if (!ALLOWED_KINDS.has(kind)) kind = "catalogue";

  const subject = norm(fd.get("subject"));
  const body = norm(fd.get("body"));
  const buttonLabel = norm(fd.get("button_label"));
  const companyId = norm(fd.get("company_id"));
  const department = norm(fd.get("department"));

  let fileMeta: {
    file_name: string | null;
    file_path: string | null;
    file_type: string | null;
    file_size: number | null;
  } = { file_name: null, file_path: null, file_type: null, file_size: null };

  const file = fd.get("file");
  if (file && typeof file === "object" && "arrayBuffer" in file && (file as File).size > 0) {
    const saved = await saveCatalogueUpload(file as File);
    if ("error" in saved) {
      return NextResponse.json({ error: saved.error }, { status: 400 });
    }
    fileMeta = saved;
  }

  const id = randomUUID();
  await db.execute(
    `INSERT INTO company_catalogues
       (id, user_id, kind, title, subject, body, button_label, company_id, department,
        file_name, file_path, file_type, file_size)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      session.id,
      kind,
      title,
      subject,
      body,
      buttonLabel,
      companyId,
      department,
      fileMeta.file_name,
      fileMeta.file_path,
      fileMeta.file_type,
      fileMeta.file_size,
    ]
  );

  const [rows] = await db.execute(
    "SELECT * FROM company_catalogues WHERE id = ? LIMIT 1",
    [id]
  );
  return NextResponse.json({ item: (rows as any[])[0] }, { status: 201 });
}
