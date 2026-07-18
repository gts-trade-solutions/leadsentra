import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/companies/template
 *
 * Returns an .xlsx companies-import template with a real Excel data-validation
 * dropdown on the `segment` column. The dropdown values come from the live
 * `company_segments` table so admins never have to keep two lists in sync.
 *
 * The valid values live on a hidden "Lists" sheet rather than inline in the
 * data-validation formula — Excel caps inline list strings at 255 chars,
 * which breaks once you have more than a handful of segments.
 *
 * Staff-only (admins + moderators); same gate as the CSV upload.
 */
export async function GET() {
  const gate = await requireRole("staff");
  if ("response" in gate) return gate.response;

  const [rows] = await db.execute(
    "SELECT name FROM company_segments ORDER BY name ASC"
  );
  const segments = (rows as any[])
    .map((r) => String(r.name ?? "").trim())
    .filter(Boolean);

  // Keep this in lockstep with the canonical column order used by the CSV
  // template and the import route's HEADER_ALIASES.
  const headers = [
    "company_id",
    "company_name",
    "legal_name",
    "trading_name",
    "company_type",
    "segment",
    "size",
    "head_office_address",
    // Was "city_regency" — renamed so the spreadsheet header matches the
    // "Region" column shown in the UI. The importer accepts both names.
    "region",
    "country",
    "postal_code",
    "website",
    "phone_main",
    "email_general",
    "linkedin",
    "facebook_url",
    "instagram_url",
    "notes",
    "company_profile",
    "financial_reports",
    "forecast_value",
  ];
  const segmentColIdx = headers.indexOf("segment") + 1; // 1-based: F
  const segmentColLetter = colLetter(segmentColIdx);

  const wb = new ExcelJS.Workbook();
  wb.creator = "LeadSentra";
  wb.created = new Date();

  const ws = wb.addWorksheet("Companies");
  ws.addRow(headers);
  // Bold the header row so the template reads cleanly when opened.
  ws.getRow(1).font = { bold: true };
  ws.columns = headers.map((h) => ({ header: h, key: h, width: Math.max(14, h.length + 2) }));

  // Hidden lookup sheet for the dropdown source range. Excel honours data
  // validations that reference another sheet by name, so we drop each segment
  // into column A and point the validation at that range.
  const listSheet = wb.addWorksheet("Lists");
  listSheet.state = "veryHidden";
  if (segments.length === 0) {
    // Without at least one value, Excel skips the dropdown silently. Drop a
    // sentinel so the dropdown still exists; users can ignore it.
    listSheet.getCell("A1").value = "(no segments configured yet)";
  } else {
    segments.forEach((seg, i) => {
      listSheet.getCell(`A${i + 1}`).value = seg;
    });
  }
  const listRangeRef = `Lists!$A$1:$A$${Math.max(segments.length, 1)}`;

  // Apply data validation to a generous block of segment cells so the dropdown
  // is available as the admin pastes/imports rows. 2000 rows comfortably
  // covers our 5 MB CSV upload limit.
  for (let r = 2; r <= 2000; r++) {
    ws.getCell(`${segmentColLetter}${r}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [listRangeRef],
      showErrorMessage: true,
      errorStyle: "warning",
      errorTitle: "Unknown segment",
      error:
        "This value isn't in the segments list. The row will still import, but won't be filterable until an admin adds the segment.",
    };
  }

  const buf = await wb.xlsx.writeBuffer();
  return new NextResponse(buf as any, {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="companies_template.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}

/** Convert a 1-based column index to its A1 letter (1 -> "A", 27 -> "AA"). */
function colLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
