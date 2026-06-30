import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type PDFImage } from "pdf-lib";
import { money } from "./invoices";
import {
  DEFAULT_LBI_BLOCKS,
  buildPlaceholderMap,
  fillPlaceholders,
  type OfferBlock,
} from "./offerTemplate";

/**
 * Block-driven renderer for offer PDFs. The 6-section RACE INTELLECT (LBI)
 * layout is just the DEFAULT template — any admin-defined template (an ordered
 * list of blocks with {{placeholders}}) renders through the same engine. Only
 * the dynamic fields come from the offer record; templates reuse that one set.
 *
 * pdf-lib StandardFonts use WinAnsi encoding and throw on code points outside
 * CP1252 (e.g. ₹). Every string goes through safe(); money is ASCII.
 */

export type OfferPdfRoute = { route_text: string };

export type OfferPdfData = {
  offer_number: string;
  issue_date: string; // YYYY-MM-DD
  currency: string;

  seller_company?: string | null;
  seller_address?: string | null;
  seller_email?: string | null;
  seller_email2?: string | null;
  seller_phone?: string | null;

  bank_name?: string | null;
  bank_account?: string | null;
  bank_branch?: string | null;
  bank_ifsc?: string | null;
  bank_legal_name?: string | null;

  customer_company?: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
  customer_address?: string | null;
  salutation?: string | null;

  subject?: string | null;
  routes: OfferPdfRoute[];
  cargo_length?: string | null;
  cargo_weight?: string | null;
  cargo_diameter?: string | null;

  survey_timeline?: string | null;
  delivery?: string | null;
  total: number;
  tax_rate?: number | null;
  payment_terms?: string | null;
  validity_days?: number | null;

  letter_signatory_name?: string | null;
  letter_signatory_title?: string | null;
  offer_signatory_name?: string | null;
  offer_signatory_title?: string | null;

  notes?: string | null;
};

export type OfferPdfAssets = {
  logo?: Uint8Array | null;
};

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const M = 42; // outer margin
const PAD = 14; // inner padding inside the page border
const INK = rgb(0.09, 0.11, 0.14);
const MUTED = rgb(0.34, 0.38, 0.43);
const ACCENT = rgb(0.13, 0.27, 0.52);
const LINE = rgb(0.62, 0.65, 0.68);
const LIGHT = rgb(0.92, 0.93, 0.95);

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
  return money(amount).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function embedImage(doc: PDFDocument, bytes?: Uint8Array | null): Promise<PDFImage | null> {
  if (!bytes || !bytes.length) return null;
  try {
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

export async function generateOfferPdf(
  data: OfferPdfData,
  assets: OfferPdfAssets = {},
  blocks?: OfferBlock[] | null
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Offer ${safe(data.offer_number)}`);
  doc.setCreator("LeadSentra");

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
  const logo = await embedImage(doc, assets.logo);

  const left = M + PAD;
  const right = PAGE_W - M - PAD;
  const width = right - left;
  const cur = (data.currency || "INR").toUpperCase();
  const map = buildPlaceholderMap(data);
  const fill = (t: string) => fillPlaceholders(t, map);

  const tpl = blocks && blocks.length ? blocks : DEFAULT_LBI_BLOCKS;

  let page: PDFPage = null as unknown as PDFPage;
  let y = 0;

  const drawFrame = () => {
    page.drawRectangle({
      x: M, y: M, width: PAGE_W - 2 * M, height: PAGE_H - 2 * M,
      borderColor: LINE, borderWidth: 0.8,
    });
  };

  const wrap = (text: string, f: PDFFont, size: number, maxW: number): string[] => {
    const words = safe(text).split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let cur2 = "";
    for (const word of words) {
      let w = word;
      while (f.widthOfTextAtSize(w, size) > maxW) {
        let i = w.length - 1;
        while (i > 1 && f.widthOfTextAtSize(w.slice(0, i), size) > maxW) i--;
        if (cur2) { lines.push(cur2); cur2 = ""; }
        lines.push(w.slice(0, i));
        w = w.slice(i);
      }
      const trial = cur2 ? `${cur2} ${w}` : w;
      if (f.widthOfTextAtSize(trial, size) > maxW) { if (cur2) lines.push(cur2); cur2 = w; }
      else cur2 = trial;
    }
    if (cur2) lines.push(cur2);
    return lines.length ? lines : [""];
  };

  const startPage = (withLogoStrip: boolean) => {
    page = doc.addPage([PAGE_W, PAGE_H]);
    drawFrame();
    y = PAGE_H - M - PAD;
    if (withLogoStrip && logo) {
      const lw = 34;
      const lh = (logo.height / logo.width) * lw;
      page.drawImage(logo, { x: left, y: y - lh + 6, width: lw, height: lh });
      y -= 30;
    }
  };

  const ensure = (h: number) => {
    if (y - h < M + PAD + 26) startPage(true);
  };

  type TxtOpts = { size?: number; font?: PDFFont; color?: any };
  const text = (s: string, x: number, yy: number, o: TxtOpts = {}) =>
    page.drawText(safe(s), { x, y: yy, size: o.size ?? 9.5, font: o.font ?? font, color: o.color ?? INK });
  const rtext = (s: string, xRight: number, yy: number, o: TxtOpts = {}) => {
    const f = o.font ?? font; const ss = safe(s); const size = o.size ?? 9.5;
    page.drawText(ss, { x: xRight - f.widthOfTextAtSize(ss, size), y: yy, size, font: f, color: o.color ?? INK });
  };
  const ctext = (s: string, cx: number, yy: number, o: TxtOpts = {}) => {
    const f = o.font ?? font; const ss = safe(s); const size = o.size ?? 9.5;
    page.drawText(ss, { x: cx - f.widthOfTextAtSize(ss, size) / 2, y: yy, size, font: f, color: o.color ?? INK });
  };

  /** One wrapped paragraph (honours newlines), advancing y. */
  const para = (
    rawText: string,
    o: { size?: number; font?: PDFFont; color?: any; align?: "left" | "center" | "right"; gap?: number } = {}
  ) => {
    const size = o.size ?? 9.5;
    const lh = size + 4;
    const f = o.font ?? font;
    for (const piece of String(rawText ?? "").split(/\r?\n/)) {
      const lines = wrap(piece, f, size, width);
      for (const ln of lines) {
        ensure(lh);
        if (o.align === "center") ctext(ln, (left + right) / 2, y - size, { size, font: f, color: o.color });
        else if (o.align === "right") rtext(ln, right, y - size, { size, font: f, color: o.color });
        else text(ln, left, y - size, { size, font: f, color: o.color });
        y -= lh;
      }
    }
    if (o.gap) y -= o.gap;
  };

  /** Bullet / numbered list. Ordered items "Head: body" bold the head. */
  const bullets = (items: string[], ordered: boolean) => {
    const size = 9;
    const lh = size + 4;
    const indent = ordered ? 16 : 14;
    items.forEach((raw, idx) => {
      const itemText = fill(raw);
      const marker = ordered ? `${String.fromCharCode(97 + (idx % 26))}.` : "·";
      let head = "";
      let bodyText = itemText;
      if (ordered) {
        const ci = itemText.indexOf(":");
        if (ci > 0 && ci < 60) { head = itemText.slice(0, ci + 1); bodyText = itemText.slice(ci + 1).trim(); }
      }
      const firstLineMaxW = right - (left + indent) - (head ? bold.widthOfTextAtSize(safe(head) + " ", size) : 0);
      // Render marker + (bold head) on the first line, then wrap the rest.
      ensure(lh);
      text(marker, left + 2, y - size, { size, font: bold, color: ordered ? INK : ACCENT });
      let cursorX = left + indent;
      if (head) {
        text(head, cursorX, y - size, { size, font: bold });
        cursorX += bold.widthOfTextAtSize(safe(head) + " ", size);
      }
      const headLines = wrap(bodyText, font, size, head ? firstLineMaxW : right - (left + indent));
      // first line goes after the head; remaining lines hang at indent
      if (headLines.length) text(headLines[0], cursorX, y - size, { size });
      y -= lh;
      for (let i = 1; i < headLines.length; i++) {
        ensure(lh);
        text(headLines[i], left + indent, y - size, { size });
        y -= lh;
      }
    });
  };

  const heading = (rawText: string, level: 1 | 2 | 3, align: "left" | "center") => {
    const size = level === 1 ? 13 : level === 2 ? 11 : 10;
    ensure(size + 12);
    const t = fill(rawText);
    if (align === "center") ctext(t, (left + right) / 2, y - size, { size, font: bold, color: ACCENT });
    else text(t, left, y - size, { size, font: bold, color: ACCENT });
    y -= size + 10;
  };

  const letterhead = () => {
    const topY = y;
    if (logo) {
      const lw = 58;
      const lh = (logo.height / logo.width) * lw;
      page.drawImage(logo, { x: left, y: topY - lh, width: lw, height: lh });
    }
    let hy = topY - 4;
    const lines: Array<{ s: string; bold?: boolean }> = [];
    lines.push({ s: data.seller_company || "RACE INNOVATIONS (P) LTD.", bold: true });
    for (const piece of String(data.seller_address || "").split(/\r?\n/)) if (piece.trim()) lines.push({ s: piece.trim() });
    if (data.seller_email || data.seller_email2) lines.push({ s: "EMAIL:" });
    if (data.seller_email) lines.push({ s: data.seller_email });
    if (data.seller_email2) lines.push({ s: data.seller_email2 });
    for (const l of lines) {
      rtext(l.s, right, hy - 8, { size: l.bold ? 9 : 8, font: l.bold ? bold : font, color: l.bold ? INK : MUTED });
      hy -= 11;
    }
    const logoBottom = logo ? topY - (logo.height / logo.width) * 58 : topY;
    y = Math.min(logoBottom, hy) - 12;
  };

  const banking = () => {
    para(data.bank_legal_name || data.seller_company || "RACE INNOVATIONS PRIVATE LIMITED.", { font: bold });
    if (data.bank_name) para(data.bank_name);
    if (data.bank_account) para(`AC.NO. ${data.bank_account}`);
    if (data.bank_ifsc) para(`IFSC - ${data.bank_ifsc}`);
    if (data.bank_branch) para(`BRANCH - ${data.bank_branch}`);
  };

  const routesTable = () => {
    const cSl = left;
    const wSl = 26;
    const cCost = right - 96;
    const cTime = cCost - 150;
    const cRoute = cSl + wSl;
    const headH = 22;

    ensure(headH + 40);
    const tableTop = y;
    page.drawRectangle({ x: left, y: y - headH, width, height: headH, color: LIGHT });
    page.drawRectangle({ x: left, y: y - headH, width, height: headH, borderColor: LINE, borderWidth: 0.8 });
    [cRoute, cTime, cCost].forEach((x) =>
      page.drawLine({ start: { x, y: y - headH }, end: { x, y }, thickness: 0.8, color: LINE })
    );
    text("Sl.", cSl + 5, y - 14, { size: 8.5, font: bold });
    text("Route", cRoute + 6, y - 14, { size: 8.5, font: bold });
    text("Timeline", cTime + 6, y - 14, { size: 8.5, font: bold });
    rtext("Cost in INR", right - 6, y - 14, { size: 8.5, font: bold });
    y -= headH;

    const routes = data.routes.length ? data.routes : [{ route_text: "" }];
    const lineH = 11;
    routes.forEach((r, i) => {
      const lines = wrap(r.route_text, font, 8.5, cTime - cRoute - 10);
      const rowH = Math.max(lines.length * lineH, lineH) + 8;
      ensure(rowH);
      const top = y;
      text(String(i + 1), cSl + 5, top - 13, { size: 8.5 });
      lines.forEach((ln, j) => text(ln, cRoute + 6, top - 13 - j * lineH, { size: 8.5 }));
      page.drawLine({ start: { x: left, y: top - rowH }, end: { x: cTime, y: top - rowH }, thickness: 0.5, color: LINE });
      y -= rowH;
    });
    const tableBottom = y;
    const midY = (tableTop - headH + tableBottom) / 2;

    const tLines = wrap(data.survey_timeline || "", font, 8.5, cCost - cTime - 10);
    tLines.forEach((ln, j) => text(ln, cTime + 6, midY + (tLines.length - 1) * 5.5 - j * 11 - 3, { size: 8.5 }));
    rtext(pdfMoney(data.total, cur), right - 6, midY - 3, { size: 9.5, font: bold });

    [cRoute, cTime, cCost].forEach((x) =>
      page.drawLine({ start: { x, y: tableBottom }, end: { x, y: tableTop - headH }, thickness: 0.8, color: LINE })
    );
    page.drawLine({ start: { x: left, y: tableBottom }, end: { x: right, y: tableBottom }, thickness: 0.8, color: LINE });
    page.drawLine({ start: { x: left, y: tableBottom }, end: { x: left, y: tableTop - headH }, thickness: 0.8, color: LINE });
    page.drawLine({ start: { x: right, y: tableBottom }, end: { x: right, y: tableTop - headH }, thickness: 0.8, color: LINE });
    y = tableBottom - 12;
  };

  // ---- walk the blocks ----
  startPage(false);
  for (const block of tpl) {
    switch (block.type) {
      case "page_break":
        startPage(true);
        break;
      case "letterhead":
        letterhead();
        break;
      case "spacer":
        y -= block.size ?? 8;
        break;
      case "heading":
        heading(block.text, block.level ?? 2, block.align ?? "left");
        break;
      case "paragraph": {
        const f = block.bold ? bold : block.italic ? italic : font;
        para(fill(block.text), {
          font: f,
          color: block.muted ? MUTED : INK,
          align: block.align ?? "left",
          gap: 4,
        });
        break;
      }
      case "bullets":
        bullets(block.items || [], !!block.ordered);
        y -= 4;
        break;
      case "quote_no":
        ensure(18);
        rtext(fill(block.text), right, y - 10, { size: 10, font: bold });
        y -= 22;
        break;
      case "routes_table":
        routesTable();
        break;
      case "banking":
        banking();
        break;
    }
  }

  // ---- footer on every page ----
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const pn = `Page ${i + 1} of ${pages.length}`;
    p.drawText(pn, { x: PAGE_W - M - PAD - font.widthOfTextAtSize(pn, 7), y: M + 4, size: 7, font, color: MUTED });
    p.drawText(safe(`Quote ${data.offer_number}`), { x: M + PAD, y: M + 4, size: 7, font, color: MUTED });
  });

  return doc.save();
}
