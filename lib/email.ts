import { Resend } from "resend";

/**
 * Transactional email sender.
 *
 * - In production: sends via Resend if RESEND_API_KEY is set.
 * - In development: if the key isn't set, falls back to console-logging the
 *   link so you can click it without needing real email delivery.
 *
 * Env vars:
 *   RESEND_API_KEY     - Resend API key (https://resend.com)
 *   EMAIL_FROM         - "from" address.  For Resend sandbox use
 *                        "onboarding@resend.dev" (only delivers to the
 *                        email on your Resend account).  For prod, verify
 *                        your own domain in Resend and use e.g.
 *                        "LeadSentra <noreply@yourdomain.com>".
 *   EMAIL_REPLY_TO     - (optional) Reply-To address.
 */

function baseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    "http://localhost:3000"
  );
}

function fromAddress(): string {
  return process.env.EMAIL_FROM || "LeadSentra <onboarding@resend.dev>";
}

let _resend: Resend | null = null;
function resend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

export function isResendConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

export function isDevEnv(): boolean {
  return process.env.NODE_ENV !== "production";
}

/**
 * Auto-on whenever NODE_ENV != production AND Resend isn't configured.
 * When true, callers (register / resend-otp) may return the OTP in the API
 * response so the dev experience isn't blocked by missing email creds.
 * Never true in production.
 */
export function shouldExposeOtpInResponse(): boolean {
  return isDevEnv() && !isResendConfigured();
}

export type SendResult =
  | { ok: true }
  | { ok: false; reason: "not_configured" }
  | { ok: false; reason: "send_failed"; error: string };

async function send(
  to: string,
  subject: string,
  html: string,
  text: string
): Promise<SendResult> {
  const client = resend();
  if (!client) {
    // eslint-disable-next-line no-console
    console.log(
      `[DEV email] to=${to}  subject="${subject}"\n` +
      `         (RESEND_API_KEY not set — not actually sending.)\n` +
      `         Body:\n${text}`
    );
    return { ok: false, reason: "not_configured" };
  }
  try {
    const { error } = await client.emails.send({
      from: fromAddress(),
      to,
      subject,
      html,
      text,
      replyTo: process.env.EMAIL_REPLY_TO,
    });
    if (error) {
      const message = (error as any)?.message || JSON.stringify(error);
      // eslint-disable-next-line no-console
      console.error("[email] Resend send failed", error);
      return { ok: false, reason: "send_failed", error: message };
    }
    return { ok: true };
  } catch (e: any) {
    // eslint-disable-next-line no-console
    console.error("[email] Resend threw", e);
    return { ok: false, reason: "send_failed", error: e?.message || String(e) };
  }
}

// ---- HTML template ----
function shell(opts: { heading: string; intro: string; ctaLabel: string; ctaUrl: string; footer?: string }): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#0b1220;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#0b1220;padding:32px 0;">
      <tr>
        <td align="center">
          <table role="presentation" cellpadding="0" cellspacing="0" width="560" style="max-width:560px;background:#111827;border:1px solid #1f2937;border-radius:14px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 8px 32px;color:#fff;">
                <div style="font-size:14px;color:#10b981;letter-spacing:.06em;text-transform:uppercase;font-weight:600;">LeadSentra</div>
                <h1 style="margin:8px 0 0 0;font-size:22px;line-height:1.3;color:#fff;">${escapeHtml(opts.heading)}</h1>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 0 32px;color:#cbd5e1;font-size:14px;line-height:1.6;">
                <p style="margin:8px 0 16px 0;">${escapeHtml(opts.intro)}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 24px 32px;">
                <a href="${opts.ctaUrl}" style="display:inline-block;background:#10b981;color:#fff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px;font-size:14px;">${escapeHtml(opts.ctaLabel)}</a>
                <p style="margin:16px 0 0 0;color:#94a3b8;font-size:12px;line-height:1.5;">
                  Or copy and paste this URL into your browser:<br/>
                  <span style="color:#cbd5e1;word-break:break-all;">${escapeHtml(opts.ctaUrl)}</span>
                </p>
              </td>
            </tr>
            ${opts.footer ? `
            <tr>
              <td style="padding:0 32px 24px 32px;color:#64748b;font-size:12px;line-height:1.5;">
                ${escapeHtml(opts.footer)}
              </td>
            </tr>` : ""}
            <tr>
              <td style="padding:16px 32px;background:#0f172a;color:#64748b;font-size:12px;">
                Sent by LeadSentra · If you didn’t request this, you can safely ignore the email.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---- verification (legacy link flow, kept for backwards compat) ----
export function verificationUrl(token: string): string {
  return `${baseUrl()}/api/auth/verify?token=${encodeURIComponent(token)}`;
}

export async function sendVerificationEmail(
  email: string,
  token: string
): Promise<void> {
  const url = verificationUrl(token);
  const subject = "Verify your LeadSentra account";
  const intro =
    "Welcome to LeadSentra. Click the button below to confirm your email address and finish setting up your account. This link expires in 24 hours.";
  const html = shell({
    heading: "Verify your email",
    intro,
    ctaLabel: "Verify email",
    ctaUrl: url,
    footer: "If you didn’t sign up for LeadSentra, no action is required.",
  });
  const text = `Verify your LeadSentra account by visiting:\n\n${url}\n\nThis link expires in 24 hours.`;
  await send(email, subject, html, text);
}

// ---- OTP verification (current signup flow) ----
function otpHtml(opts: { code: string; minutes: number }): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#0b1220;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#0b1220;padding:32px 0;">
      <tr><td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="560" style="max-width:560px;background:#111827;border:1px solid #1f2937;border-radius:14px;overflow:hidden;">
          <tr><td style="padding:28px 32px 0 32px;color:#fff;">
            <div style="font-size:14px;color:#10b981;letter-spacing:.06em;text-transform:uppercase;font-weight:600;">LeadSentra</div>
            <h1 style="margin:8px 0 0 0;font-size:22px;line-height:1.3;color:#fff;">Your verification code</h1>
          </td></tr>
          <tr><td style="padding:8px 32px 0 32px;color:#cbd5e1;font-size:14px;line-height:1.6;">
            <p style="margin:8px 0 16px 0;">Enter this 6-digit code on the verification screen to finish creating your account.</p>
          </td></tr>
          <tr><td align="center" style="padding:8px 32px 8px 32px;">
            <div style="display:inline-block;background:#0f172a;border:1px solid #1f2937;border-radius:14px;padding:18px 28px;font-family:'SFMono-Regular',Consolas,Menlo,monospace;font-size:34px;letter-spacing:8px;color:#10b981;font-weight:700;">
              ${escapeHtml(opts.code)}
            </div>
          </td></tr>
          <tr><td style="padding:12px 32px 24px 32px;color:#94a3b8;font-size:12px;line-height:1.5;">
            This code expires in ${opts.minutes} minutes. If you didn’t sign up for LeadSentra, you can ignore this email.
          </td></tr>
          <tr><td style="padding:16px 32px;background:#0f172a;color:#64748b;font-size:12px;">
            Sent by LeadSentra · Never share this code with anyone.
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
}

export async function sendVerificationOtpEmail(
  email: string,
  code: string,
  ttlMinutes: number
): Promise<SendResult> {
  const subject = `Your LeadSentra verification code: ${code}`;
  const html = otpHtml({ code, minutes: ttlMinutes });
  const text =
    `Your LeadSentra verification code is: ${code}\n\n` +
    `It expires in ${ttlMinutes} minutes.\n\n` +
    `If you didn’t sign up, ignore this email.`;
  return send(email, subject, html, text);
}

// ---- password reset ----
export function passwordResetUrl(token: string): string {
  return `${baseUrl()}/auth/reset?token=${encodeURIComponent(token)}`;
}

export async function sendPasswordResetEmail(
  email: string,
  token: string
): Promise<void> {
  const url = passwordResetUrl(token);
  const subject = "Reset your LeadSentra password";
  const intro =
    "We received a request to reset the password on your LeadSentra account. Click the button below to choose a new one. This link expires in 60 minutes.";
  const html = shell({
    heading: "Reset your password",
    intro,
    ctaLabel: "Reset password",
    ctaUrl: url,
    footer: "If you didn’t request a password reset, you can ignore this email — your password won’t change.",
  });
  const text = `Reset your LeadSentra password by visiting:\n\n${url}\n\nThis link expires in 60 minutes.\n\nIf you didn’t request this, ignore this email.`;
  await send(email, subject, html, text);
}
