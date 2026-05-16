import { NextResponse } from "next/server";

// Legacy Supabase auth-callback no-op.  Kept so old client code that still
// POSTs here doesn't 404.  New auth flow uses /api/auth/login + /api/auth/logout.
export async function POST() {
  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.redirect(
    new URL("/auth/signin", process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000")
  );
}
