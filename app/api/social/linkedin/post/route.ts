import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// TODO Phase C: port supabase/functions/linkedin-post/index.ts
// Real implementation should:
//   1) Look up social_accounts row (provider=linkedin) for the user
//   2) Refresh access_token if expires_at is past
//   3) POST to https://api.linkedin.com/v2/ugcPosts with the text + (optional) media urn
//   4) Spend a credit via spend_credit() stored procedure
//   5) Insert into linkedin_posts
export async function POST() {
  return NextResponse.json(
    {
      error:
        "LinkedIn posting is being migrated. Your post wasn't sent. Try again after Phase C.",
      code: "not_implemented",
    },
    { status: 501 }
  );
}
