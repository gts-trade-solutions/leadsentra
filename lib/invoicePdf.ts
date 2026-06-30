import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage } from "pdf-lib";
import { money, amountInWords } from "./invoices";

/**
 * Server-side proforma-invoice PDF renderer (pdf-lib, pure JS) styled to match
 * the India-standard template: a bordered document with a Communication
 * Address / invoice-meta header grid, customer + bank-details band, an
 * Sl.No / Part No / Description / Rate / Amount line-item table, GST + totals,
 * amount-in-words, and a Declaration + Authorised Signatory block.
 *
 * pdf-lib StandardFonts use WinAnsi encoding and throw on code points outside
 * CP1252 (e.g. ₹). Every string goes through safe(); money is ASCII ("Rs.").
 */

export type InvoicePdfItem = {
  part_no?: string | null;
  description: string;
  hsn?: string | null;
  quantity: number;
  unit_price: number;
  amount: number;
};

export type InvoicePdfData = {
  invoice_number: string;
  status: string;
  issue_date: string; // YYYY-MM-DD
  valid_until?: string | null;
  currency: string;

  seller_company?: string | null;
  seller_name?: string | null;
  seller_email?: string | null;
  seller_phone?: string | null;
  seller_gstin?: string | null;
  seller_pan?: string | null;
  seller_address?: string | null;

  ref?: string | null;
  payment_terms?: string | null;
  delivery_terms?: string | null;

  bank_name?: string | null;
  bank_account?: string | null;
  bank_branch?: string | null;
  bank_ifsc?: string | null;

  customer_company?: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
  customer_gstin?: string | null;
  customer_address?: string | null;

  items: InvoicePdfItem[];

  subtotal: number;
  discount: number;
  tax_rate: number;
  tax_amount: number;
  total: number;

  notes?: string | null;
  terms?: string | null;
  declaration?: string | null;
  signatory_name?: string | null;
};

export type InvoicePdfAssets = {
  logo?: Uint8Array | null;
  signature?: Uint8Array | null;
};

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 36; // outer margin
const INK = rgb(0.07, 0.09, 0.12);
const MUTED = rgb(0.33, 0.37, 0.42);
const LINE = rgb(0.55, 0.58, 0.62);
const LIGHT = rgb(0.9, 0.92, 0.94);

function safe(s: unknown): string {
  return String(s ?? "")
    .replace(/₹/g, "Rs.")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
}

function pdfMoney(amount: number, code: string): string {
  const c = (code || "INR").toUpperCase();
  const locale = c === "INR" ? "en-IN" : "en-US";
  const n = money(amount).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n;
}

/** YYYY-MM-DD -> "23-Jan-26". Falls back to the raw string if unparseable. */
function fmtDate(s: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  if (!m) return safe(s);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mo = months[Number(m[2]) - 1] || m[2];
  return `${m[3]}-${mo}-${m[1].slice(2)}`;
}

async function embedImage(doc: PDFDocument, bytes?: Uint8Array | null): Promise<PDFImage | null> {
  if (!bytes || !bytes.length) return null;
  try {
    // PNG magic number 0x89 'P' 'N' 'G'
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return await doc.embedPng(bytes);
    return await doc.embedJpg(bytes);
  } catch {
    try {
      return await doc.embedPng(bytes);
    } catch {
      return null;
    }
  }
}

export async function generateInvoicePdf(
  data: InvoicePdfData,
  assets: InvoicePdfAssets = {}
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Proforma Invoice ${safe(data.invoice_number)}`);
  doc.setCreator("LeadSentra");

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = await embedImage(doc, assets.logo);
  const signature = await embedImage(doc, assets.signature);

  let page = doc.addPage([PAGE_W, PAGE_H]);
  const left = M;
  const right = PAGE_W - M;
  const width = right - left;
  let y = PAGE_H - M;

  // ---- low-level helpers ----
  const txt = (s: string, x: number, yy: number, o: { size?: number; bold?: boolean; color?: any } = {}) =>
    page.drawText(safe(s), { x, y: yy, size: o.size ?? 8.5, font: o.bold ? bold : font, color: o.color ?? INK });

  const rtxt = (s: string, xRight: number, yy: number, o: { size?: number; bold?: boolean; color?: any } = {}) => {
    const f = o.bold ? bold : font;
    const ss = safe(s);
    page.drawText(ss, { x: xRight - f.widthOfTextAtSize(ss, o.size ?? 8.5), y: yy, size: o.size ?? 8.5, font: f, color: o.color ?? INK });
  };

  const hline = (x1: number, x2: number, yy: number, thick = 0.7) =>
    page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness: thick, color: LINE });
  const vline = (x: number, y1: number, y2: number, thick = 0.7) =>
    page.drawLine({ start: { x, y: y1 }, end: { x, y: y2 }, thickness: thick, color: LINE });
  const box = (x: number, yy: number, w: number, h: number, thick = 0.7) =>
    page.drawRectangle({ x, y: yy, width: w, height: h, borderColor: LINE, borderWidth: thick });

  const wrap = (text: string, f: PDFFont, size: number, maxW: number): string[] => {
    const words = safe(text).split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let cur = "";
    for (const word of words) {
      let w = word;
      while (f.widthOfTextAtSize(w, size) > maxW) {
        let i = w.length - 1;
        while (i > 1 && f.widthOfTextAtSize(w.slice(0, i), size) > maxW) i--;
        if (cur) { lines.push(cur); cur = ""; }
        lines.push(w.slice(0, i));
        w = w.slice(i);
      }
      const trial = cur ? `${cur} ${w}` : w;
      if (f.widthOfTextAtSize(trial, size) > maxW) { if (cur) lines.push(cur); cur = w; }
      else cur = trial;
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [""];
  };

  // ---- Title bar ----
  const titleH = 26;
  box(left, y - titleH, width, titleH, 1);
  page.drawText("PROFORMA INVOICE", {
    x: left + width / 2 - bold.widthOfTextAtSize("PROFORMA INVOICE", 14) / 2,
    y: y - titleH + 8,
    size: 14,
    font: bold,
    color: INK,
  });
  if (logo) {
    const lw = 46;
    const lh = (logo.height / logo.width) * lw;
    page.drawImage(logo, { x: left + 6, y: y - titleH + (titleH - Math.min(lh, titleH - 4)) / 2, width: lw, height: Math.min(lh, titleH - 4) });
  }
  y -= titleH;

  // ---- Header band: seller (left) | meta grid (right) ----
  const midX = left + width * 0.52;
  const labelW = 92; // width of the label column inside the meta grid
  const metaLabelX = midX + 6;
  const metaValX = midX + labelW;

  const meta: Array<[string, string]> = [
    ["INVOICE TYPE", "Proforma Invoice"],
    ["INVOICE NO", data.invoice_number],
    ["DATE", fmtDate(data.issue_date)],
    ["Mode/Terms of Payment", data.payment_terms || "-"],
    ["PAN No", data.seller_pan || "-"],
    ["REF", data.ref || "-"],
    ["Delivery", data.delivery_terms || "-"],
  ];

  // Pre-measure both columns to size the band.
  const sellerLines: Array<{ s: string; bold?: boolean; size?: number }> = [];
  sellerLines.push({ s: "Communication Address :", size: 7.5 });
  sellerLines.push({ s: data.seller_company || data.seller_name || "", bold: true, size: 9.5 });
  for (const piece of String(data.seller_address || "").split(/\r?\n/)) {
    if (piece.trim()) for (const wl of wrap(piece, font, 8, width * 0.5 - 12)) sellerLines.push({ s: wl });
  }
  if (data.seller_gstin) sellerLines.push({ s: `GSTIN : ${data.seller_gstin}` });
  if (data.seller_email) sellerLines.push({ s: `Email : ${data.seller_email}` });

  const metaRowH = 14;
  const metaH = meta.reduce((acc, [, v]) => {
    const vl = wrap(v, font, 8, right - metaValX - 4).length;
    return acc + Math.max(metaRowH, vl * 10 + 4);
  }, 0);
  const sellerH = sellerLines.reduce((acc, l) => acc + (l.size ? l.size + 3.5 : 11.5), 6);
  const bandH = Math.max(metaH, sellerH) + 6;

  box(left, y - bandH, width, bandH);
  vline(midX, y - bandH, y);

  // seller (left)
  let sy = y - 11;
  for (const l of sellerLines) {
    txt(l.s, left + 6, sy, { size: l.size ?? 8, bold: l.bold, color: l.size === 7.5 ? MUTED : INK });
    sy -= l.size ? l.size + 3.5 : 11.5;
  }
  // meta grid (right)
  let my = y;
  for (const [k, v] of meta) {
    const vlines = wrap(v, font, 8, right - metaValX - 4);
    const rh = Math.max(metaRowH, vlines.length * 10 + 4);
    hline(midX, right, my - rh, 0.5);
    vline(metaValX - 6, my - rh, my, 0.5);
    txt(k, metaLabelX, my - 10, { size: 7.5, color: MUTED });
    vlines.forEach((vl, i) => txt(vl, metaValX, my - 10 - i * 10, { size: 8 }));
    my -= rh;
  }
  y -= bandH;

  // ---- Customer (left) | Bank details (right) ----
  const custLines: Array<{ s: string; bold?: boolean }> = [];
  custLines.push({ s: "Name & Address of the Customer" });
  custLines.push({ s: data.customer_company || data.customer_name || "", bold: true });
  if (data.customer_company && data.customer_name) custLines.push({ s: data.customer_name! });
  for (const piece of String(data.customer_address || "").split(/\r?\n/)) {
    if (piece.trim()) for (const wl of wrap(piece, font, 8, width * 0.5 - 12)) custLines.push({ s: wl });
  }
  if (data.customer_gstin) custLines.push({ s: `GSTIN : ${data.customer_gstin}` });
  if (data.customer_email) custLines.push({ s: `Email : ${data.customer_email}` });

  const bank: Array<[string, string]> = [];
  if (data.bank_name || data.bank_account || data.bank_branch || data.bank_ifsc) {
    bank.push(["Bank", data.bank_name || "-"]);
    bank.push(["Account No", data.bank_account || "-"]);
    bank.push(["Branch", data.bank_branch || "-"]);
    bank.push(["IFSC Code", data.bank_ifsc || "-"]);
  }
  const custH = custLines.length * 11.5 + 10;
  const bankH = (bank.length ? bank.length * 13 : 13) + 16;
  const band2H = Math.max(custH, bankH);

  box(left, y - band2H, width, band2H);
  vline(midX, y - band2H, y);
  let cy = y - 11;
  for (const l of custLines) {
    txt(l.s, left + 6, cy, { size: l.bold ? 9 : 8, bold: l.bold, color: l === custLines[0] ? MUTED : INK });
    cy -= 11.5;
  }
  txt("BANK DETAILS :", metaLabelX, y - 11, { size: 8, bold: true });
  let by = y - 26;
  for (const [k, v] of bank) {
    txt(k, metaLabelX, by, { size: 8, color: MUTED });
    txt(":", midX + labelW - 8, by, { size: 8, color: MUTED });
    txt(v, metaValX, by, { size: 8 });
    by -= 13;
  }
  y -= band2H;

  // ---- Items table ----
  const cSl = left;
  const cPart = left + 30;
  const cDesc = left + 95;
  const cRate = right - 170;
  const cAmt = right - 85;
  const descW = cRate - cDesc - 6;

  const headH = 26;
  const drawItemsHeader = () => {
    page.drawRectangle({ x: left, y: y - headH, width, height: headH, color: LIGHT });
    box(left, y - headH, width, headH);
    [cPart, cDesc, cRate, cAmt].forEach((x) => vline(x, y - headH, y));
    txt("Sl.No", cSl + 3, y - 11, { size: 7.5, bold: true });
    txt("Part No", cPart + 3, y - 11, { size: 7.5, bold: true });
    txt("Description", cDesc + 3, y - 11, { size: 7.5, bold: true });
    rtxt("Rate", cAmt - 6, y - 8, { size: 7.5, bold: true });
    txt("INR", cRate + 4, y - 19, { size: 7, color: MUTED });
    rtxt("Amount", right - 4, y - 8, { size: 7.5, bold: true });
    txt("INR", cAmt + 4, y - 19, { size: 7, color: MUTED });
    y -= headH;
  };

  const newPage = () => {
    box(left, M, width, PAGE_H - 2 * M); // close current frame best-effort
    page = doc.addPage([PAGE_W, PAGE_H]);
    y = PAGE_H - M;
    drawItemsHeader();
  };

  drawItemsHeader();
  const tableTop = y;
  const rowPad = 5;
  const lineH = 10;

  data.items.forEach((it, idx) => {
    const dLines = wrap(it.description, font, 8, descW);
    const rowH = Math.max(dLines.length * lineH, lineH) + rowPad;
    if (y - rowH < M + 150) newPage();
    const top = y;
    txt(String(idx + 1), cSl + 4, top - 9, { size: 8 });
    if (it.part_no) wrap(it.part_no, font, 7.5, cDesc - cPart - 6).forEach((pl, i) => txt(pl, cPart + 3, top - 9 - i * 9, { size: 7.5 }));
    dLines.forEach((dl, i) => txt(dl, cDesc + 3, top - 9 - i * lineH, { size: 8 }));
    rtxt(pdfMoney(it.unit_price, data.currency), cAmt - 6, top - 9, { size: 8 });
    rtxt(pdfMoney(it.amount, data.currency), right - 4, top - 9, { size: 8, bold: true });
    y -= rowH;
  });

  // Pad the table to a minimum height, then the GST/total rows live inside it.
  const minBodyBottom = tableTop - 120;
  if (y > minBodyBottom) y = minBodyBottom;

  // vertical separators across the full body
  [cPart, cDesc, cRate, cAmt].forEach((x) => vline(x, y, tableTop));

  // Totals rows (right side, inside the Amount/Rate columns)
  const totRow = (label: string, value: string, opts: { bold?: boolean } = {}) => {
    hline(cRate, right, y, 0.5);
    rtxt(label, cAmt - 6, y - 11, { size: 8.5, bold: opts.bold });
    rtxt(value, right - 4, y - 11, { size: 8.5, bold: opts.bold });
    y -= 16;
  };
  totRow("Sub Total", pdfMoney(data.subtotal, data.currency));
  if (data.discount > 0) totRow("Discount", `- ${pdfMoney(data.discount, data.currency)}`);
  if (data.tax_rate > 0) totRow(`GST ${data.tax_rate}%`, pdfMoney(data.tax_amount, data.currency));
  totRow("Total", pdfMoney(data.total, data.currency), { bold: true });

  // close the items box
  hline(left, right, y, 0.7);
  vline(left, y, tableTop);
  vline(right, y, tableTop);

  // ---- Amount chargeable in words ----
  // The figure is right-aligned; the words are constrained to the space to its
  // LEFT and wrap onto extra lines, so a long amount can never overlap/crowd
  // the figure. (amountInWords already reads "Rupees … Only" — no "INR" prefix.)
  const cur = (data.currency || "INR").toUpperCase();
  const amtStr = `${cur} ${pdfMoney(data.total, data.currency)}`;
  const amtW = bold.widthOfTextAtSize(amtStr, 9);
  const wordsX = left + 6;
  const wordsMaxW = Math.max(140, right - 6 - amtW - 16 - wordsX);
  const wordLines = wrap(amountInWords(data.total, data.currency), bold, 8.5, wordsMaxW);
  const wordsH = Math.max(24, 13 + wordLines.length * 11);
  box(left, y - wordsH, width, wordsH);
  txt("Amount Chargeable (in words)", wordsX, y - 9, { size: 7.5, color: MUTED });
  wordLines.forEach((wl, i) => txt(wl, wordsX, y - 20 - i * 11, { size: 8.5, bold: true }));
  rtxt(amtStr, right - 6, y - 20, { size: 9, bold: true });
  y -= wordsH;
  txt("E & O.E", left + 6, y - 9, { size: 7, color: MUTED });
  y -= 14;

  // ---- Declaration + signatory ----
  const decl =
    data.declaration ||
    "Certified that the particulars given above are true and the amount indicated represents the price actually charged and that there is no flow of additional consideration directly or indirectly from the buyer.";
  const declLines = wrap(decl, font, 7.5, width * 0.55);
  const sigBlockH = 78;
  const declH = Math.max(declLines.length * 10 + 26, sigBlockH);
  box(left, y - declH, width, declH);
  vline(midX, y - declH, y);

  txt("Declaration:", left + 6, y - 11, { size: 8, bold: true });
  declLines.forEach((dl, i) => txt(dl, left + 6, y - 23 - i * 10, { size: 7.5, color: MUTED }));

  txt(`For ${data.seller_company || data.seller_name || ""}`, metaLabelX, y - 11, { size: 8.5, bold: true });
  if (signature) {
    const sw = 90;
    const sh = Math.min((signature.height / signature.width) * sw, 34);
    page.drawImage(signature, { x: metaLabelX, y: y - 16 - sh, width: sw, height: sh });
  }
  rtxt("Authorised Signatory", right - 6, y - declH + 8, { size: 8 });
  if (data.signatory_name) txt(data.signatory_name, metaLabelX, y - declH + 20, { size: 8, color: MUTED });
  y -= declH;

  // ---- Notes / Terms (optional, below the frame) ----
  if (data.notes || data.terms) {
    y -= 10;
    if (data.notes) {
      txt("Notes:", left, y, { size: 8, bold: true });
      y -= 11;
      for (const piece of String(data.notes).split(/\r?\n/))
        for (const wl of wrap(piece, font, 8, width)) { txt(wl, left, y, { size: 8, color: MUTED }); y -= 10; }
    }
    if (data.terms) {
      y -= 4;
      txt("Terms & Conditions:", left, y, { size: 8, bold: true });
      y -= 11;
      for (const piece of String(data.terms).split(/\r?\n/))
        for (const wl of wrap(piece, font, 8, width)) { txt(wl, left, y, { size: 8, color: MUTED }); y -= 10; }
    }
  }

  // ---- Footer on every page ----
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawText("This is a Computer Generated Proforma Invoice", { x: left, y: 22, size: 7, font, color: MUTED });
    const pn = `Page ${i + 1} of ${pages.length}`;
    p.drawText(pn, { x: right - font.widthOfTextAtSize(pn, 7), y: 22, size: 7, font, color: MUTED });
  });

  return doc.save();
}
