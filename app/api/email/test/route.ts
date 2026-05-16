import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// TODO Phase C: port supabase/functions/email-send-test/index.ts
// (debits 1 credit via spend_credit, sends test mail via SES, logs to email_sends).
export async function POST() {
  return NextResponse.json(
    { error: "Test email is being migrated. Please try again later." },
    { status: 501 }
  );
}
