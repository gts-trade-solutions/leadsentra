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

  // Rewrite ALL href links through our click-tracker, EXCEPT the unsubscribe
  // URL itself (we never want to rewrite that — would break Gmail one-click).
  body = body.replace(/href="([^"]+)"/g, (_m, url) => {
    if (url === unsubUrl) return `href="${url}"`;
    return `href="${baseUrl}/api/track/click?c=${campaignId}&t=${trackingToken}&u=${encodeURIComponent(url)}"`;
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
