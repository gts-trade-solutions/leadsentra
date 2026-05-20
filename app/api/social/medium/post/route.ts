import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { isStaff } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PRICE_PER_POST = 1;

/**
 * POST /api/social/medium/post
 * Body: { text: string, image_url?: string }
 *
 * Medium needs both a title and a body. We derive the title from the first
 * non-empty line of `text` (capped at 100 chars) and use the rest as the body.
 * If `text` is a single short line, the whole thing becomes the title and the
 * body falls back to the title.
 *
 * Image is embedded at the top of the body as markdown.
 */
export async function POST(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const text = String(body?.text || "").trim();
  const imageUrl = body?.image_url ? String(body.image_url) : null;
  if (!text) {
    return NextResponse.json({ error: "Empty post — Medium requires text" }, { status: 400 });
  }

  const token = process.env.MEDIUM_INTEGRATION_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "Medium not configured (MEDIUM_INTEGRATION_TOKEN missing)" },
      { status: 500 }
    );
  }

  let userId = process.env.MEDIUM_USER_ID;
  if (!userId) {
    // Fetch on demand. Medium's /me is cheap.
    try {
      const r = await fetch("https://api.medium.com/v1/me", {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        cache: "no-store",
      });
      const j: any = await r.json().catch(() => ({}));
      if (!r.ok || !j?.data?.id) {
        return NextResponse.json(
          { error: j?.errors?.[0]?.message || "Failed to fetch Medium user id" },
          { status: 502 }
        );
      }
      userId = j.data.id as string;
    } catch (e: any) {
      return NextResponse.json(
        { error: e?.message || "Failed to reach Medium API" },
        { status: 502 }
      );
    }
  }

  if (!isStaff(session.role)) {
    try {
      await db.query("CALL spend_credit(?, ?, ?, ?, ?)", [
        session.id,
        PRICE_PER_POST,
        "debit",
        `md_post:${Date.now()}`,
        "Post to Medium",
      ]);
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (msg.includes("insufficient_credits")) {
        return NextResponse.json(
          { error: "Insufficient credits", code: "insufficient_credits" },
          { status: 402 }
        );
      }
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  }

  const { title, content } = splitTitleAndBody(text, imageUrl);

  const payload = {
    title,
    contentFormat: "markdown",
    content,
    publishStatus: "public",
  };

  const resp = await fetch(
    `https://api.medium.com/v1/users/${userId}/posts`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );
  const respJson: any = await resp.json().catch(() => ({}));
  if (!resp.ok || !respJson?.data?.id) {
    return NextResponse.json(
      { error: respJson?.errors?.[0]?.message || "Medium post failed" },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    id: respJson.data.id,
    url: respJson.data.url,
  });
}

function splitTitleAndBody(
  text: string,
  imageUrl: string | null,
): { title: string; content: string } {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const firstNonEmpty = lines.find((l) => l.length > 0) || text.slice(0, 100);
  const title = firstNonEmpty.slice(0, 100);

  // Body = everything after the first paragraph break, or the whole text if
  // there's only one line.
  const firstBreakIdx = text.indexOf("\n");
  const rest = firstBreakIdx >= 0 ? text.slice(firstBreakIdx + 1).trim() : title;

  const imageMd = imageUrl ? `![${title}](${imageUrl})\n\n` : "";
  // Medium also needs the title repeated as an H1 inside the body — otherwise
  // the post just shows the body with no heading on the article page.
  const content = `${imageMd}# ${title}\n\n${rest}`;

  return { title, content };
}
