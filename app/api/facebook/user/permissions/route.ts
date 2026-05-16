import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Stubbed during Supabase -> MySQL migration. Phase D (Facebook / storage)
// will restore real behavior.  Returns 501 cleanly so callers don't see
// a 500 stack trace.
function stub() {
  return NextResponse.json(
    {
      error: "This endpoint is being migrated. Please try again later.",
      code: "not_implemented",
    },
    { status: 501 }
  );
}

export const GET = stub;
export const POST = stub;
export const PUT = stub;
export const PATCH = stub;
export const DELETE = stub;
