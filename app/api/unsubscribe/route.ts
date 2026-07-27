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
 *   - The plain-text "unsubscribe" link inside the email — the recipient
 *     clicks it, lands on a confirmation page (GET) and presses a button
 *     which POSTs back here.
 *
 * The POST flow:
 *   1. Find campaign_recipients row by tracking_token
 *   2. Insert into suppressions (user_id, type='email', value=email,
 *      source='unsubscribe') with INSERT IGNORE
 *   3. Mark the recipient row as 'suppressed' so it never receives further
 *      mail from the same campaign owner.
 *
 * GET NEVER MUTATES.  It used to, and corporate mail gateways (Mimecast,
 * Proofpoint, O365 ATP …) fetch every URL in an inbound message to scan it —
 * so they unsubscribed recipients who never asked.  The fingerprint in the
 * data was unmistakable: the unsubscribe landed 4–11 seconds BEFORE the open
 * pixel (impossible for a human, who must render the mail to see the link),
 * with an identical click count across unrelated recipients, and several of
 * those "unsubscribed" people carried on clicking for hours afterwards.
 * RFC 8058 requires the one-click flow to be a POST for exactly this reason.
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

/** Look up the address a token belongs to WITHOUT changing anything. */
async function peek(token: string): Promise<{ ok: boolean; email?: string; error?: string }> {
  if (!token || token.length < 16) return { ok: false, error: "Invalid token" };
  const [rows] = await db.execute(
    "SELECT email FROM campaign_recipients WHERE tracking_token = ? LIMIT 1",
    [token]
  );
  const row = (rows as any[])[0];
  if (!row) return { ok: false, error: "Unknown token" };
  return { ok: true, email: row.email };
}

/**
 * The mutating side.  Two callers:
 *   - Gmail/Yahoo one-click (List-Unsubscribe-Post) → wants a 2xx, body ignored
 *   - The confirmation page's form → carries `ui=1`, wants HTML back
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("t") || "";

  // Read the form body to tell the two callers apart.  Gmail sends
  // `List-Unsubscribe=One-Click`; our page sends `ui=1`.
  let fromPage = false;
  try {
    const raw = await req.text();
    fromPage = new URLSearchParams(raw).get("ui") === "1";
  } catch {
    /* no body — treat as the header flow */
  }

  const result = await processUnsubscribe(token);
  if (!fromPage) {
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  }

  return page(
    result.ok ? "Unsubscribed" : "Could not unsubscribe",
    result.ok
      ? `<p>You have been unsubscribed from this sender's emails. You will not receive further messages.</p>${
          result.email ? `<p class="muted">Address: ${escape(result.email)}</p>` : ""
        }`
      : `<p>We couldn't process this request: ${escape(result.error || "Unknown error")}.</p><p>The link may have expired.</p>`,
    result.ok,
    result.ok ? 200 : 400
  );
}

/**
 * The link inside the email.  Renders a confirmation button and changes
 * nothing — a GET here is as likely to be a security scanner as a person.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("t") || "";
  const found = await peek(token);

  if (!found.ok) {
    return page(
      "Could not unsubscribe",
      `<p>We couldn't process this request: ${escape(found.error || "Unknown error")}.</p><p>The link may have expired.</p>`,
      false,
      400
    );
  }

  return page(
    "Unsubscribe",
    `<p>Confirm that you no longer want to receive emails from this sender.</p>
     ${found.email ? `<p class="muted">Address: ${escape(found.email)}</p>` : ""}
     <form method="post" action="/api/unsubscribe?t=${encodeURIComponent(token)}">
       <input type="hidden" name="ui" value="1" />
       <button type="submit">Yes, unsubscribe me</button>
     </form>
     <p class="muted">You are still subscribed until you press the button.</p>`,
    true,
    200
  );
}

function page(heading: string, body: string, ok: boolean, status: number) {
  const html = `<!doctype html><html><head><meta charset="utf-8">
<title>${heading}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{font-family:system-ui,-apple-system,sans-serif;background:#0b0f15;color:#e5e7eb;margin:0;display:grid;place-items:center;min-height:100vh;padding:24px}
  .card{max-width:480px;width:100%;background:#111827;border:1px solid #1f2937;border-radius:16px;padding:32px;box-shadow:0 10px 30px rgba(0,0,0,.4)}
  h1{margin:0 0 12px;font-size:22px;color:${ok ? "#34d399" : "#f87171"}}
  p{margin:8px 0;line-height:1.5}
  .muted{color:#6b7280;font-size:13px}
  a{color:#34d399}
  button{margin:16px 0 4px;padding:10px 18px;font-size:15px;border-radius:8px;border:1px solid #34d399;background:#34d399;color:#062018;cursor:pointer}
  button:hover{background:#2bb98a;border-color:#2bb98a}
</style></head>
<body><div class="card"><h1>${heading}</h1>${body}</div></body></html>`;

  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

function escape(s: string) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}
