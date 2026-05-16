import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Unsubscribe endpoint targeted by:
 *   - The List-Unsubscribe header (Gmail/Yahoo one-click):
 *       List-Unsubscribe: <https://APP_URL/api/unsubscribe?t=TOKEN>
 *       List-Unsubscribe-Post: List-Unsubscribe=One-Click
 *     Email clients send a POST with body `List-Unsubscribe=One-Click`.
 *   - The plain-text "unsubscribe" link inside the email — user clicks it,
 *     lands on a confirmation page (GET).
 *
 * Both flows:
 *   1. Find campaign_recipients row by tracking_token
 *   2. Insert into suppressions (user_id, type='email', value=email,
 *      source='unsubscribe') with INSERT IGNORE
 *   3. Mark the recipient row as 'suppressed' so it never receives further
 *      mail from the same campaign owner.
 *
 * No auth required — the token is the proof.  Tokens are 32-hex chars
 * (uuidv4 without dashes), so unguessable.
 */

async function processUnsubscribe(token: string): Promise<{ ok: boolean; email?: string; error?: string }> {
  if (!token || token.length < 16) return { ok: false, error: "Invalid token" };

  const [rows] = await db.execute(
    `SELECT cr.id, cr.email, cr.status, c.user_id
       FROM campaign_recipients cr
       JOIN campaigns c ON c.id = cr.campaign_id
      WHERE cr.tracking_token = ?
      LIMIT 1`,
    [token]
  );
  const row = (rows as any[])[0];
  if (!row) return { ok: false, error: "Unknown token" };

  // Best-effort INSERT — if already suppressed (unique user_id+type+value), skip.
  await db.execute(
    `INSERT IGNORE INTO suppressions (user_id, type, value, reason, source)
     VALUES (?, 'email', ?, 'User clicked unsubscribe', 'unsubscribe')`,
    [row.user_id, row.email]
  );

  // Flip the recipient row so the tracking page shows it correctly.
  if (row.status === "queued" || row.status === "sent" || row.status === "delivered") {
    await db.execute(
      "UPDATE campaign_recipients SET status = 'suppressed', last_event_at = NOW() WHERE id = ?",
      [row.id]
    );
  }

  return { ok: true, email: row.email };
}

/** One-click unsubscribe (Gmail/Yahoo): POST with form body. */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("t") || "";
  const result = await processUnsubscribe(token);
  // Gmail one-click expects 2xx; body is ignored.
  return NextResponse.json(result, { status: result.ok ? 200 : 400 });
}

/** User-clicked link: GET that returns a small HTML confirmation page. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("t") || "";
  const result = await processUnsubscribe(token);

  const heading = result.ok ? "Unsubscribed" : "Could not unsubscribe";
  const body = result.ok
    ? `<p>You have been unsubscribed from this sender's emails. You will not receive further messages.</p>${
        result.email ? `<p style="color:#6b7280">Address: ${escape(result.email)}</p>` : ""
      }`
    : `<p>We couldn't process this request: ${escape(result.error || "Unknown error")}.</p><p>The link may have expired.</p>`;

  const html = `<!doctype html><html><head><meta charset="utf-8">
<title>${heading}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font-family:system-ui,-apple-system,sans-serif;background:#0b0f15;color:#e5e7eb;margin:0;display:grid;place-items:center;min-height:100vh;padding:24px}
  .card{max-width:480px;width:100%;background:#111827;border:1px solid #1f2937;border-radius:16px;padding:32px;box-shadow:0 10px 30px rgba(0,0,0,.4)}
  h1{margin:0 0 12px;font-size:22px;color:${result.ok ? "#34d399" : "#f87171"}}
  p{margin:8px 0;line-height:1.5}
  a{color:#34d399}
</style></head>
<body><div class="card"><h1>${heading}</h1>${body}</div></body></html>`;

  return new Response(html, {
    status: result.ok ? 200 : 400,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

function escape(s: string) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}
