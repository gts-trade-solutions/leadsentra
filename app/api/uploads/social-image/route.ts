import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import AWS from "aws-sdk";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB — fits FB / IG / LinkedIn image limits
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

const REGION = process.env.AWS_REGION || "ap-south-1";
const BUCKET = process.env.AWS_S3_BUCKET_NAME || "";
const PUBLIC_BASE = (
  process.env.NEXT_PUBLIC_S3_BUCKET_URL ||
  `https://${BUCKET}.s3.${REGION}.amazonaws.com/`
).replace(/\/?$/, "/");

/**
 * POST /api/uploads/social-image
 * Body: multipart/form-data with field "file" (image)
 *
 * Uploads to S3 under `uploads/<userId>/<uuid>.<ext>` and returns
 * a public https URL the social APIs (FB, IG, LinkedIn) can fetch.
 */
export async function POST(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!BUCKET) {
    return NextResponse.json(
      { error: "AWS_S3_BUCKET_NAME is not set" },
      { status: 500 }
    );
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!form || !(file instanceof File)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json(
      { error: `Unsupported type ${file.type} — use JPEG, PNG, or WebP` },
      { status: 400 }
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large (max ${MAX_BYTES / 1024 / 1024} MB)` },
      { status: 400 }
    );
  }

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const key = `uploads/${session.id}/${randomUUID()}.${ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());

  const s3 = new AWS.S3({
    region: REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  });

  try {
    await s3
      .putObject({
        Bucket: BUCKET,
        Key: key,
        Body: bytes,
        ContentType: file.type,
        CacheControl: "public, max-age=31536000, immutable",
      })
      .promise();
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "S3 upload failed" },
      { status: 502 }
    );
  }

  return NextResponse.json({ url: `${PUBLIC_BASE}${key}`, key });
}
