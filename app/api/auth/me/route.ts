import { NextResponse } from "next/server";
import { getUser, findUserById } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getUser();
  if (!session) return NextResponse.json({ user: null });

  const user = await findUserById(session.id);
  return NextResponse.json({ user });
}
