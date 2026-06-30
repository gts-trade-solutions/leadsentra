import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { isStaff } from "@/lib/admin";
import { saveCatalogueUpload } from "@/lib/catalogueUpload";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const norm = (v: unknown) =>
  typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : null;

const ALLOWED_KINDS = new Set(["catalogue", "offer"]);

async function fetchOwned(id: string, userId: string, staff: boolean) {
  const sql = staff
    ? "SELECT * FROM company_catalogues WHERE id = ? LIMIT 1"
    : "SELECT * FROM company_catalogues WHERE id = ? AND (user_id = ? OR user_id IS NULL) LIMIT 1";
  const params = staff ? [id] : [id, userId];
  const [rows] = await db.execute(sql, params);
  return (rows as any[])[0] || null;
}

/**
 * PATCH /api/catalogues/[id]  (multipart/form-data)
 *
 * Updates any subset of: kind, title, subject, body, company_id, department.
 * If a new `file` is included, it replaces the stored file. Send field
 * "remove_file"="1" to clear an existing file without uploading a new one.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const staff = isStaff(session.role);
  const existing = await fetchOwned(params.id, session.id, staff);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.user_id && existing.user_id !== session.id && !staff) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const fd = await req.formData().catch(() => null);
  if (!fd) return NextResponse.json({ error: "Expected form data" }, { status: 400 });

  const sets: string[] = [];
  const vals: any[] = [];

  // Plain text/select fields — only updated when the key is actually present.
  const setIf = (key: string, col: string, transform?: (v: string | null) => any) => {
    if (!fd.has(key)) return;
    const raw = norm(fd.get(key));
    sets.push(`${col} = ?`);
    vals.push(transform ? transform(raw) : raw);
  };

  setIf("kind", "kind", (v) => (v && ALLOWED_KINDS.has(v) ? v : "catalogue"));
  if (fd.has("title")) {
    const t = norm(fd.get("title"));
    if (!t) return NextResponse.json({ error: "Title cannot be empty" }, { status: 400 });
    sets.push("title = ?");
    vals.push(t);
  }
  setIf("subject", "subject");
  setIf("body", "body");
  setIf("company_id", "company_id");
  setIf("department", "department");

  // File handling: replace, clear, or leave as-is.
  const file = fd.get("file");
  if (file && typeof file === "object" && "arrayBuffer" in file && (file as File).size > 0) {
    const saved = await saveCatalogueUpload(file as File);
    if ("error" in saved) return NextResponse.json({ error: saved.error }, { status: 400 });
    sets.push("file_name = ?", "file_path = ?", "file_type = ?", "file_size = ?");
    vals.push(saved.file_name, saved.file_path, saved.file_type, saved.file_size);
  } else if (norm(fd.get("remove_file")) === "1") {
    sets.push("file_name = NULL", "file_path = NULL", "file_type = NULL", "file_size = NULL");
  }

  if (!sets.length) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  vals.push(params.id);
  await db.execute(
    `UPDATE company_catalogues SET ${sets.join(", ")} WHERE id = ?`,
    vals
  );

  const [rows] = await db.execute(
    "SELECT * FROM company_catalogues WHERE id = ? LIMIT 1",
    [params.id]
  );
  return NextResponse.json({ item: (rows as any[])[0] });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const staff = isStaff(session.role);
  const existing = await fetchOwned(params.id, session.id, staff);
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.user_id && existing.user_id !== session.id && !staff) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await db.execute("DELETE FROM company_catalogues WHERE id = ?", [params.id]);
  return NextResponse.json({ ok: true });
}
