import { NextResponse } from "next/server";
import { getUser, findUserById } from "@/lib/auth";
import { getModeratorPages } from "@/lib/modPageAccess";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getUser();
  if (!session) return NextResponse.json({ user: null });

  const user = await findUserById(session.id);
  if (!user) return NextResponse.json({ user: null });

  // For moderators, attach the page-access allowlist so AuthGuard can enforce
  // it client-side. null = full access (legacy default).
  let page_access: string[] | null = null;
  if (user.role === "moderator") {
    page_access = await getModeratorPages(user.id);
  }
  return NextResponse.json({ user: { ...user, page_access } });
}
