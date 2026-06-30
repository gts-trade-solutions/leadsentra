/**
 * Returns the unsubscribe URL used in both the List-Unsubscribe header and
 * the in-body unsubscribe link.  Exported so the email provider can set the
 * header to the same URL the recipient sees in the footer.
 */
export function unsubscribeUrl(trackingToken: string, baseUrl: string): string {
  return `${baseUrl}/api/unsubscribe?t=${encodeURIComponent(trackingToken)}`;
}

export function withTracking(html: string, campaignId: string, trackingToken: string, baseUrl: string) {
  const unsubUrl = unsubscribeUrl(trackingToken, baseUrl);

  // Replace template placeholders with the real unsubscribe URL so users who
  // explicitly add `{{unsubscribe_url}}` or `<a href="{{unsubscribe_link}}">...`
  // get a working link.  Both are interchangeable.
  let body = html
    .replace(/\{\{\s*unsubscribe_url\s*\}\}/gi, unsubUrl)
    .replace(/\{\{\s*unsubscribe_link\s*\}\}/gi, unsubUrl);

  // Rewrite href links through our click-tracker, but ONLY real http(s)
  // navigations.  Anything else must be left untouched:
  //   - the unsubscribe URL (rewriting it breaks Gmail one-click)
  //   - mailto: / tel: / sms: links (the footer contact email + phone) — these
  //     aren't web pages, so routing them through /api/track/click lands the
  //     recipient on the app home page instead of opening their mail/dialer
  //   - in-page anchors (#...) and unresolved {{template}} placeholders
  // Handles both double- and single-quoted href attributes.
  body = body.replace(/href=(["'])(.*?)\1/g, (whole, quote, url) => {
    if (url === unsubUrl) return whole;
    // Only http:// and https:// links are click-tracked; everything else
    // (mailto:, tel:, sms:, #anchor, {{placeholder}}, relative paths) passes
    // through verbatim so it behaves exactly as the author intended.
    if (!/^https?:\/\//i.test(url)) return whole;
    return `href=${quote}${baseUrl}/api/track/click?c=${campaignId}&t=${trackingToken}&u=${encodeURIComponent(url)}${quote}`;
  });

  // If the message didn't include an unsubscribe link of its own, append a
  // discreet footer.  Required for CAN-SPAM, GDPR, and post-2024 Gmail/Yahoo
  // bulk-sender compliance.
  const hasUnsubMention = /unsubscribe/i.test(body) || body.includes(unsubUrl);
  if (!hasUnsubMention) {
    body += `<hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px"/>
<p style="color:#6b7280;font-size:11px;line-height:1.4;font-family:Arial,sans-serif">
  Don't want these emails? <a href="${unsubUrl}" style="color:#6b7280;text-decoration:underline">Unsubscribe</a>.
</p>`;
  }

  // 1x1 open-tracking pixel — last so it doesn't appear in the visible footer.
  const pixel = `<img src="${baseUrl}/api/track/open?c=${campaignId}&t=${trackingToken}" width="1" height="1" style="display:none" alt="" />`;
  return body + pixel;
}

/**
 * Best-effort HTML -> plain text converter for the multipart/alternative part.
 * Spam filters score messages that have ONLY HTML as more suspicious.
 */
export function htmlToText(html: string): string {
  return String(html)
    // hidden tracking pixel and similar -> drop
    .replace(/<img[^>]*display\s*:\s*none[^>]*>/gi, "")
    // <a href="X">Y</a> -> Y (X)  — keep both link text + URL
    .replace(/<a\s+[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    // line breaks
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/(h[1-6]|li|div|tr)>/gi, "\n")
    // strip all remaining tags
    .replace(/<[^>]+>/g, "")
    // decode common entities
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // collapse whitespace
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Ensure an email body is well-formed, nicely-formatted HTML.
 *
 * If the body already contains HTML markup it's returned unchanged. If it's
 * PLAIN TEXT (what you get when someone types a message without an HTML
 * template), it is escaped, bare URLs/emails are linkified (so they're
 * clickable AND click-trackable), line breaks are preserved, and the whole
 * thing is wrapped in a clean, email-safe container. Without this, plain text
 * collapses into one unformatted blob because HTML ignores newlines.
 */
export function ensureEmailHtml(body: string | null | undefined): string {
  const raw = String(body ?? "");
  if (!raw.trim()) return raw;

  // Heuristic: does it already contain a real HTML tag (or a doctype)?
  const looksLikeHtml = /<!doctype/i.test(raw) || /<([a-z][\w-]*)(\s[^>]*)?>/i.test(raw);
  if (looksLikeHtml) return raw;

  const escaped = raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Single pass linkify so URLs/emails aren't double-processed.
  const linked = escaped.replace(
    /(https?:\/\/[^\s<]+|www\.[^\s<]+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi,
    (m) => {
      const style = 'color:#2563eb;text-decoration:underline;';
      if (/^[A-Z0-9._%+-]+@/i.test(m)) {
        return `<a href="mailto:${m}" style="${style}">${m}</a>`;
      }
      const href = m.toLowerCase().startsWith("www.") ? `http://${m}` : m;
      return `<a href="${href}" target="_blank" rel="noopener noreferrer" style="${style}">${m}</a>`;
    }
  );

  // Preserve paragraphs (blank line) and single line breaks.
  const withBreaks = linked.replace(/\r\n/g, "\n").replace(/\n/g, "<br>");

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#ffffff;">
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.6;color:#1f2937;max-width:640px;margin:0 auto;padding:16px;word-break:break-word;">
${withBreaks}
    </div>
  </body>
</html>`;
}
