import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// TODO Phase C: port supabase/functions/ai-image/index.ts
// Real implementation should:
//   1) Spend N credits via spend_credit()
//   2) Call OpenAI images.generate (gpt-image-1 or dall-e-3) at 1792x1024
//   3) Upload result to S3 (S3_BUCKET_PUBLIC) under social-assets/<user_id>/<uuid>.png
//   4) Return { url } so the client can preview/post it
export async function POST() {
  return NextResponse.json(
    {
      error:
        "AI image generation is being migrated. Please upload an image instead.",
      code: "not_implemented",
    },
    { status: 501 }
  );
}
