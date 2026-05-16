import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// TODO Phase C: port `email-campaigns/oneoff/send` from supabase/functions/email-campaigns/index.ts
// (debits 1 credit, sends via SES with tracking pixel + click redirects, logs to oneoff_emails).
export async function POST() {
  return NextResponse.json(
    { error: "One-off email send is being migrated. Please try again later." },
    { status: 501 }
  );
}
