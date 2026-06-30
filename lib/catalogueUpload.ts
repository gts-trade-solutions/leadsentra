import { randomUUID } from "crypto";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

// Where uploaded catalogue/offer files land. Served statically by Next from
// the public/ directory, so the saved file_path is a clean public URL.
// Lives in lib/ (not a route file) so multiple routes can import it.
const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "catalogues");
const PUBLIC_PREFIX = "/uploads/catalogues";

export type SavedUpload = {
  file_name: string;
  file_path: string;
  file_type: string | null;
  file_size: number;
};

/**
 * Persist an uploaded File to public/uploads/catalogues and return its meta.
 * Returns { error } instead of throwing on validation failures.
 */
export async function saveCatalogueUpload(
  file: File
): Promise<SavedUpload | { error: string }> {
  const MAX_BYTES = 25 * 1024 * 1024; // 25 MB
  if (file.size > MAX_BYTES) {
    return { error: "File too large (max 25 MB)" };
  }
  const buf = Buffer.from(await file.arrayBuffer());
  await mkdir(UPLOAD_DIR, { recursive: true });
  // Keep the original extension; randomise the stem so names never collide.
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
