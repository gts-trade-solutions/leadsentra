import { formatMoney } from "./invoices";
import type { InvoiceRecord, InvoiceItemRecord } from "./invoiceRepo";

/**
 * Builds the HTML + plain-text email body for a proforma invoice. The PDF is
 * attached separately by the send route; this is the inline summary the
 * recipient sees in their client.
 */

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function nl2br(s: string): string {
  return esc(s).replace(/\r?\n/g, "<br/>");
}

export function buildInvoiceEmail(
  invoice: InvoiceRecord,
  items: InvoiceItemRecord[],
  opts: { message?: string } = {}
): { subject: string; html: string; text: string } {
  const cur = invoice.currency;
  const sellerName = invoice.seller_company || invoice.seller_name || "We";
  const subject = `Proforma Invoice ${invoice.invoice_number} from ${invoice.seller_company || invoice.seller_name || "us"}`;

  const intro =
    opts.message?.trim() ||
    `Please find your proforma invoice ${invoice.invoice_number} below. A PDF copy is attached for your records.`;

  const hasItems = items.length > 0;
  const rows = items
    .map(
      (it, i) => `
      <tr>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#64748b;">${i + 1}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;color:#0f172a;">${esc(it.description)}${
        it.hsn ? `<br/><span style="color:#94a3b8;font-size:12px;">HSN: ${esc(it.hsn)}</span>` : ""
      }</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;color:#0f172a;">${esc(it.quantity)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;color:#0f172a;">${esc(formatMoney(it.unit_price, cur))}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e5e7eb;text-align:right;color:#0f172a;font-weight:600;">${esc(formatMoney(it.amount, cur))}</td>
      </tr>`
    )
    .join("");

  const totalsRows = [
    `<tr><td style="padding:4px 10px;text-align:right;color:#64748b;">Subtotal</td><td style="padding:4px 10px;text-align:right;color:#0f172a;width:140px;">${esc(formatMoney(invoice.subtotal, cur))}</td></tr>`,
    invoice.discount > 0
      ? `<tr><td style="padding:4px 10px;text-align:right;color:#64748b;">Discount</td><td style="padding:4px 10px;text-align:right;color:#0f172a;">- ${esc(formatMoney(invoice.discount, cur))}</td></tr>`
      : "",
    invoice.tax_rate > 0
      ? `<tr><td style="padding:4px 10px;text-align:right;color:#64748b;">Tax (${esc(invoice.tax_rate)}%)</td><td style="padding:4px 10px;text-align:right;color:#0f172a;">${esc(formatMoney(invoice.tax_amount, cur))}</td></tr>`
      : "",
    `<tr><td style="padding:8px 10px;text-align:right;color:#0f172a;font-weight:700;border-top:2px solid #10b981;">Total</td><td style="padding:8px 10px;text-align:right;color:#059669;font-weight:700;border-top:2px solid #10b981;">${esc(formatMoney(invoice.total, cur))}</td></tr>`,
  ].join("");

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f1f5f9;padding:24px 0;">
      <tr><td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="640" style="max-width:640px;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
          <tr><td style="padding:24px 28px 8px 28px;">
            <table role="presentation" width="100%"><tr>
              <td style="vertical-align:top;">
                <div style="font-size:18px;font-weight:700;color:#0f172a;">${esc(invoice.seller_company || invoice.seller_name || "")}</div>
                ${invoice.seller_address ? `<div style="color:#64748b;font-size:12px;margin-top:4px;">${nl2br(invoice.seller_address)}</div>` : ""}
                ${invoice.seller_gstin ? `<div style="color:#64748b;font-size:12px;">GSTIN: ${esc(invoice.seller_gstin)}</div>` : ""}
              </td>
              <td style="vertical-align:top;text-align:right;">
                <div style="font-size:16px;font-weight:700;color:#059669;letter-spacing:.04em;">PROFORMA INVOICE</div>
                <div style="color:#0f172a;font-size:13px;margin-top:4px;">${esc(invoice.invoice_number)}</div>
                <div style="color:#64748b;font-size:12px;">Date: ${esc(invoice.issue_date)}</div>
                ${invoice.valid_until ? `<div style="color:#64748b;font-size:12px;">Valid until: ${esc(invoice.valid_until)}</div>` : ""}
              </td>
            </tr></table>
          </td></tr>

          <tr><td style="padding:8px 28px;">
            <div style="font-size:11px;font-weight:700;color:#059669;text-transform:uppercase;letter-spacing:.06em;">Bill To</div>
            <div style="color:#0f172a;font-size:14px;font-weight:600;margin-top:4px;">${esc(invoice.customer_company || invoice.customer_name || "")}</div>
            ${invoice.customer_company && invoice.customer_name ? `<div style="color:#475569;font-size:13px;">${esc(invoice.customer_name)}</div>` : ""}
            ${invoice.customer_address ? `<div style="color:#64748b;font-size:12px;margin-top:2px;">${nl2br(invoice.customer_address)}</div>` : ""}
            ${invoice.customer_gstin ? `<div style="color:#64748b;font-size:12px;">GSTIN: ${esc(invoice.customer_gstin)}</div>` : ""}
          </td></tr>

          <tr><td style="padding:12px 28px 0 28px;color:#475569;font-size:14px;line-height:1.6;">
            <p style="margin:8px 0 16px 0;">${nl2br(intro)}</p>
          </td></tr>

          ${
            hasItems
              ? `<tr><td style="padding:0 28px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;">
              <thead><tr style="background:#f8fafc;">
                <th style="padding:8px 10px;text-align:left;color:#64748b;font-size:11px;text-transform:uppercase;">#</th>
                <th style="padding:8px 10px;text-align:left;color:#64748b;font-size:11px;text-transform:uppercase;">Description</th>
                <th style="padding:8px 10px;text-align:right;color:#64748b;font-size:11px;text-transform:uppercase;">Qty</th>
                <th style="padding:8px 10px;text-align:right;color:#64748b;font-size:11px;text-transform:uppercase;">Rate</th>
                <th style="padding:8px 10px;text-align:right;color:#64748b;font-size:11px;text-transform:uppercase;">Amount</th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </td></tr>

          <tr><td style="padding:8px 28px 0 28px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td>
              <table role="presentation" align="right" cellpadding="0" cellspacing="0" style="min-width:280px;">${totalsRows}</table>
            </td></tr></table>
          </td></tr>`
              : `<tr><td style="padding:8px 28px;color:#475569;font-size:13px;">Please see the attached PDF for the full proforma invoice.</td></tr>`
          }

          ${
            invoice.notes
              ? `<tr><td style="padding:16px 28px 0 28px;"><div style="font-size:11px;font-weight:700;color:#059669;text-transform:uppercase;">Notes</div><div style="color:#475569;font-size:13px;margin-top:4px;">${nl2br(invoice.notes)}</div></td></tr>`
              : ""
          }
          ${
            invoice.terms
              ? `<tr><td style="padding:12px 28px 0 28px;"><div style="font-size:11px;font-weight:700;color:#059669;text-transform:uppercase;">Terms &amp; Conditions</div><div style="color:#475569;font-size:13px;margin-top:4px;">${nl2br(invoice.terms)}</div></td></tr>`
              : ""
          }

          <tr><td style="padding:20px 28px;color:#94a3b8;font-size:11px;line-height:1.5;border-top:1px solid #e5e7eb;margin-top:16px;">
            This is a proforma invoice (a quotation of goods/services) and not a tax invoice or a demand for payment.
            ${invoice.seller_email ? `For questions, reply to this email or contact ${esc(invoice.seller_email)}.` : ""}
          </td></tr>
        </table>
        <div style="color:#94a3b8;font-size:11px;margin-top:12px;">Sent via LeadSentra</div>
      </td></tr>
    </table>
  </body>
</html>`;

  const textLines = [
    `PROFORMA INVOICE ${invoice.invoice_number}`,
    `From: ${invoice.seller_company || invoice.seller_name || ""}`,
    `Date: ${invoice.issue_date}${invoice.valid_until ? `  Valid until: ${invoice.valid_until}` : ""}`,
    "",
    `Bill To: ${invoice.customer_company || invoice.customer_name || ""}`,
    "",
    intro,
    "",
    ...items.map(
      (it, i) =>
        `${i + 1}. ${it.description} — ${it.quantity} x ${formatMoney(it.unit_price, cur)} = ${formatMoney(it.amount, cur)}`
    ),
    "",
    `Subtotal: ${formatMoney(invoice.subtotal, cur)}`,
    invoice.discount > 0 ? `Discount: -${formatMoney(invoice.discount, cur)}` : "",
    invoice.tax_rate > 0 ? `Tax (${invoice.tax_rate}%): ${formatMoney(invoice.tax_amount, cur)}` : "",
    `Total: ${formatMoney(invoice.total, cur)}`,
    "",
    invoice.notes ? `Notes: ${invoice.notes}` : "",
    invoice.terms ? `Terms: ${invoice.terms}` : "",
    "",
    "This is a proforma invoice and not a tax invoice or demand for payment.",
  ].filter((l) => l !== "");

  return { subject, html, text: textLines.join("\n") };
}
