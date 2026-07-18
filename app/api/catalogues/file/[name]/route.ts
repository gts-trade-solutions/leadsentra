import { NextResponse } from "next/server";
import { readCatalogueFile } from "@/lib/catalogueUpload";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Content types for the file kinds a catalogue/offer upload can be. Anything
// else falls back to a generic binary type (the browser will download it).
const TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  txt: "text/plain; charset=utf-8",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/**
 * GET /api/catalogues/file/[name]
 *
 * Streams a stored catalogue/offer file off disk. This is the link target used
 * by the "Download catalogue" button in sent emails — served through the app
 * (an API route is always served) rather than via Next static serving of
 * public/, which 404s runtime-written files under `output: 'standalone'`.
 *
 * Public by design: the disk name is an unguessable UUID (capability URL), so
 * recipients who never signed in can still open the attachment from the email.
 */
export async function GET(
  _req: Request,
  { params }: { params: { name: string } }
) {
  const name = decodeURIComponent(params.name || "");
  const buf = await readCatalogueFile(name);
  if (!buf) return new NextResponse("Not found", { status: 404 });

  const ext = name.split(".").pop()?.toLowerCase() || "";
  const type = TYPES[ext] || "application/octet-stream";
  // inline so PDFs/images open in the browser; unknown types download.
  const safeName = name.replace(/["\\\r\n]/g, "");

  return new NextResponse(buf as any, {
    status: 200,
    headers: {
      "Content-Type": type,
      "Content-Disposition": `inline; filename="${safeName}"`,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
