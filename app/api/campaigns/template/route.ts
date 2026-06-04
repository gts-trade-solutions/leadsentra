import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Template recall by campaign name.
 *
 * Every campaign the user saves/sends is already stored with its name +
 * subject + html.  This endpoint lets the compose screen treat a previously
 * used name as a reusable template: type the same name again and the most
 * recent matching campaign's subject + body are returned so the form can
 * auto-fill.  Scoped to the logged-in user — you only ever see your own.
 */
export async function GET(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ template: null }, { status: 401 });

  const name = (new URL(req.url).searchParams.get("name") || "").trim();
  if (!name) return NextResponse.json({ template: null });

  // Case-insensitive exact match on the campaign name; newest first so the
  // latest edit of a recurring campaign wins.  Only rows that actually have
  // content are useful as a template.
  const [rows] = await db.execute(
    `SELECT subject, html
       FROM campaigns
      WHERE user_id = ?
        AND LOWER(name) = LOWER(?)
        AND subject IS NOT NULL
        AND html IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [session.id, name]
  );
  const row = (rows as any[])[0];
  if (!row) return NextResponse.json({ template: null });

  return NextResponse.json({
    template: { subject: row.subject ?? "", html: row.html ?? "" },
  });
}
