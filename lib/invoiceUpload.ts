import { randomUUID } from "crypto";
import { writeFile, mkdir, readFile } from "fs/promises";
import path from "path";

/**
 * File storage for the invoice feature: uploaded proforma PDFs plus the
 * seller's logo/signature images. Mirrors lib/catalogueUpload.ts — files land
 * under public/uploads/invoices and are referenced by a clean public path.
 *
 * NOTE: like catalogue uploads, these are served from public/ so the path is
 * effectively a capability URL (unguessable UUID) rather than access-controlled
 * storage. Fine for this app's current model; revisit if invoices must be
 * strictly private.
 */

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "invoices");
const PUBLIC_PREFIX = "/uploads/invoices";

export type SavedFile = {
  file_name: string;
  file_path: string; // public path, e.g. /uploads/invoices/<uuid>.pdf
  file_type: string | null;
  file_size: number;
};

type SaveOpts = {
  maxBytes?: number;
  /** Allowed lowercased mime prefixes/exact types, e.g. ["application/pdf"]. */
  allow?: string[];
};

export async function saveInvoiceFile(
  file: File,
  opts: SaveOpts = {}
): Promise<SavedFile | { error: string }> {
  const maxBytes = opts.maxBytes ?? 25 * 1024 * 1024; // 25 MB
  if (!file || typeof file.arrayBuffer !== "function") {
    return { error: "No file provided" };
  }
  if (file.size > maxBytes) {
    return { error: `File too large (max ${Math.round(maxBytes / (1024 * 1024))} MB)` };
  }
  if (opts.allow && opts.allow.length) {
    const t = (file.type || "").toLowerCase();
    const ok = opts.allow.some((a) => t === a || t.startsWith(a));
    if (!ok) return { error: "Unsupported file type" };
  }

  const buf = Buffer.from(await file.arrayBuffer());
  await mkdir(UPLOAD_DIR, { recursive: true });
  const ext = path.extname(file.name || "").slice(0, 16);
  const diskName = `${randomUUID()}${ext}`;
  await writeFile(path.join(UPLOAD_DIR, diskName), buf);

  return {
    file_name: (file.name || diskName).slice(0, 255),
    file_path: `${PUBLIC_PREFIX}/${diskName}`,
    file_type: file.type ? String(file.type).slice(0, 128) : null,
    file_size: file.size,
  };
}

/** Read a stored public-path file (e.g. "/uploads/invoices/x.pdf") off disk. */
export async function readPublicFile(publicPath: string): Promise<Buffer | null> {
  if (!publicPath || !publicPath.startsWith("/uploads/")) return null;
  // Strip leading slash and resolve under public/. Reject path traversal.
  const rel = publicPath.replace(/^\/+/, "");
  const abs = path.join(process.cwd(), "public", rel);
  const root = path.join(process.cwd(), "public", "uploads");
  if (!abs.startsWith(root)) return null;
  try {
    return await readFile(abs);
  } catch {
    return null;
  }
}
