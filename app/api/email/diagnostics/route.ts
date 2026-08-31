import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { checkConfigSet, isSesConfigured } from "@/lib/ses";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/email/diagnostics?from=<email>
 *
 * Runs every check we can server-side and returns a list of findings.
 * The compose page renders these as a colored checklist so the user can see
 * the EXACT reasons their mail might land in spam — not a vague "check DNS".
 *
 * Returns: { findings: [{level, title, detail, fixUrl?}], score, maxScore }
 */
const FREE_PROVIDER_DOMAINS = new Set([
  "gmail.com", "googlemail.com",
  "yahoo.com", "yahoo.co.in", "yahoo.co.uk", "ymail.com",
  "outlook.com", "hotmail.com", "live.com", "msn.com",
  "aol.com", "icloud.com", "me.com",
  "protonmail.com", "proton.me",
  "rediffmail.com", "zoho.com",
]);

type Level = "ok" | "warn" | "fail";
type Finding = { level: Level; title: string; detail: string; weight: number };

export async function GET(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const fromQuery = (url.searchParams.get("from") || "").trim().toLowerCase();

  // Resolve the sender — prefer query param, else look up the user's saved one.
  let fromEmail = fromQuery;
  let senderStatus: string | null = null;
  if (!fromEmail) {
    const [rows] = await db.execute(
      "SELECT email, status FROM email_identities WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1",
      [session.id]
    );
    const row = (rows as any[])[0];
    if (row) { fromEmail = String(row.email || "").toLowerCase(); senderStatus = row.status; }
  }

  const findings: Finding[] = [];

  // ---- 1. Sender domain check (BIGGEST factor) ----
  if (!fromEmail) {
    findings.push({
      level: "fail",
      title: "No sender configured",
      detail: "You haven't verified a sender email yet. Open the campaigns/new page and add one.",
      weight: 30,
    });
  } else {
    const at = fromEmail.lastIndexOf("@");
    const senderDomain = at >= 0 ? fromEmail.slice(at + 1) : "";
    if (FREE_PROVIDER_DOMAINS.has(senderDomain)) {
      findings.push({
        level: "fail",
        title: `Sending from a free provider (${senderDomain})`,
        detail:
          "Gmail/Yahoo/Outlook reject mail claiming to be from their domains but coming from outside their servers. " +
          "This is the #1 reason your mail lands in spam. Fix: change sender to an address on a domain you own " +
          "(e.g. marketing@raceautoindia.com).",
        weight: 30,
      });
    } else {
      findings.push({
        level: "ok",
        title: `Sender is on a non-free domain (${senderDomain})`,
        detail: "DKIM/SPF can be properly aligned for your own domains.",
        weight: 30,
      });
    }
    if (senderStatus && senderStatus !== "verified") {
      findings.push({
        level: "warn",
        title: `Sender status: ${senderStatus}`,
        detail: "Your sender hasn't completed verification yet. SES won't actually send from it until then.",
        weight: 5,
      });
    } else if (senderStatus === "verified") {
      findings.push({
        level: "ok",
        title: "Sender is verified in SES",
        detail: "SES will sign and accept sends from this address.",
        weight: 5,
      });
    }
  }

  // ---- 2. APP_URL must be public for List-Unsubscribe to work ----
  const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "";
  if (!appUrl) {
    findings.push({
      level: "fail",
      title: "NEXT_PUBLIC_APP_URL is not set",
      detail: "Without a public URL, List-Unsubscribe + tracking pixels are broken. Set NEXT_PUBLIC_APP_URL in .env.local.",
      weight: 20,
    });
  } else if (/^https?:\/\/(localhost|127\.0\.0\.1)/i.test(appUrl)) {
    findings.push({
      level: "fail",
      title: "List-Unsubscribe URL points to localhost",
      detail:
        `NEXT_PUBLIC_APP_URL = ${appUrl}. Gmail does a real-time POST to the unsubscribe URL to verify it's reachable. ` +
        "Since localhost is unreachable from the internet, Gmail flags your mail as suspicious. " +
        "Fix: run 'ngrok http 3000' or deploy, then set NEXT_PUBLIC_APP_URL to that public URL.",
      weight: 20,
    });
  } else if (!/^https:/i.test(appUrl)) {
    findings.push({
      level: "warn",
      title: "APP_URL uses http, not https",
      detail: "Gmail's one-click unsubscribe requires https. Use a tunnel/deploy with https.",
      weight: 10,
    });
  } else {
    findings.push({
      level: "ok",
      title: "Public https APP_URL is set",
      detail: `Outbound List-Unsubscribe + tracking pixels will be reachable at ${appUrl}.`,
      weight: 20,
    });
  }

  // ---- 3. SES Configuration Set (the bounce/complaint feedback loop) ----
  //
  // This is the single most consequential setting for repeating bounces, so it
  // is checked against SES itself rather than trusting the env var. A config
  // set that is named but publishes nothing looks configured and behaves
  // exactly like no config set at all: SES emails each bounce to the sender as
  // a MAILER-DAEMON notice, the app never records it, the address is never
  // suppressed, and the next campaign bounces it again.
  if (!process.env.SES_CONFIG_SET) {
    findings.push({
      level: "fail",
      title: "SES_CONFIG_SET is not configured — bounces never reach the app",
      detail:
        "With no SES configuration set, SES does not post Bounce/Complaint/Delivery events to " +
        "/api/email/webhooks/ses. It emails each bounce to the sender instead, so bounced addresses " +
        "are never added to Suppressions and every campaign mails them again. " +
        "Create a configuration set with an SNS event destination (BOUNCE, COMPLAINT, DELIVERY, REJECT), " +
        "point the SNS topic at " +
        `${appUrl || "https://your-app"}/api/email/webhooks/ses, then set SES_CONFIG_SET to its name.`,
      weight: 25,
    });
  } else if (!isSesConfigured()) {
    findings.push({
      level: "warn",
      title: `SES Configuration Set: ${process.env.SES_CONFIG_SET} (unverified)`,
      detail:
        "The name is set but AWS credentials are missing, so we can't confirm it publishes " +
        "bounce events. Add AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY.",
      weight: 25,
    });
  } else {
    const health = await checkConfigSet().catch(() => null);
    if (health?.publishesBounces) {
      findings.push({
        level: "ok",
        title: `SES Configuration Set: ${health.name}`,
        detail:
          `Publishing ${health.eventTypes.join(", ")}. Bounces and complaints reach the webhook, ` +
          "so failed addresses are suppressed automatically.",
        weight: 25,
      });
    } else if (health?.exists) {
      findings.push({
        level: "fail",
        title: `Configuration set "${health.name}" does not publish bounce events`,
        detail:
          (health.eventTypes.length
            ? `It publishes ${health.eventTypes.join(", ")} but not both BOUNCE and COMPLAINT. `
            : "It has no enabled event destination. ") +
          "Until it does, SES emails bounces to the sender instead of the app, and bounced " +
          "addresses are never suppressed — so the same addresses bounce on every campaign. " +
          "Add an SNS event destination covering BOUNCE, COMPLAINT, DELIVERY and REJECT.",
        weight: 25,
      });
    } else {
      findings.push({
        level: "fail",
        title: `Configuration set "${process.env.SES_CONFIG_SET}" could not be read`,
        detail:
          (health?.error || "SES did not return it.") +
          " Every send names this set, so if it does not exist in this region the sends fail outright.",
        weight: 25,
      });
    }
  }

  // ---- 4. Reply-To header ----
  if (process.env.EMAIL_REPLY_TO) {
    findings.push({
      level: "ok",
      title: `Reply-To: ${process.env.EMAIL_REPLY_TO}`,
      detail: "Replies route to a monitored address; small deliverability boost.",
      weight: 5,
    });
  } else {
    findings.push({
      level: "warn",
      title: "EMAIL_REPLY_TO not set",
      detail: "Replies default to the sender. Set EMAIL_REPLY_TO in .env.local to override.",
      weight: 2,
    });
  }

  // ---- 5. Provider configured? ----
  const hasResend = !!process.env.RESEND_API_KEY;
  const hasSES = !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY);
  if (!hasResend && !hasSES) {
    findings.push({
      level: "fail",
      title: "No real email provider configured",
      detail: "Neither RESEND_API_KEY nor AWS_ACCESS_KEY_ID is set — emails will print to the dev console instead of being sent.",
      weight: 20,
    });
  } else {
    findings.push({
      level: "ok",
      title: `Email provider: ${hasResend ? "Resend" : "AWS SES"}`,
      detail: hasResend ? "Resend is configured." : "AWS SES credentials are set.",
      weight: 5,
    });
  }

  // ---- 6. Always-on headers (informational — they're hard-coded so always ok) ----
  findings.push({
    level: "ok",
    title: "List-Unsubscribe + List-Unsubscribe-Post: One-Click",
    detail: "Every outbound bulk email carries Gmail/Yahoo-compliant unsubscribe headers.",
    weight: 5,
  });
  findings.push({
    level: "ok",
    title: "multipart/alternative (HTML + plain-text)",
    detail: "Plain-text fallback boosts spam score slightly.",
    weight: 3,
  });
  findings.push({
    level: "ok",
    title: "Feedback-ID + X-Entity-Ref-ID set",
    detail: "Gmail Postmaster Tools can break out reputation per-campaign.",
    weight: 2,
  });

  const score = findings.reduce((s, f) => s + (f.level === "ok" ? f.weight : 0), 0);
  const maxScore = findings.reduce((s, f) => s + f.weight, 0);

  return NextResponse.json({
    fromEmail,
    findings,
    score,
    maxScore,
    percent: maxScore ? Math.round((score / maxScore) * 100) : 0,
  });
}
