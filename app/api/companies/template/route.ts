import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { requireRole } from "@/lib/admin";
import {
  loadVocabularies,
  VOCAB_KINDS,
  VOCAB_COLUMN,
  type VocabKind,
} from "@/lib/vocab";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Header in the template ← the vocabulary that governs it. */
const VALIDATED_COLUMNS: Record<string, VocabKind> = {
  company_type: "company_type",
  segment: "segment",
  country: "country",
};

/** Rows of the sheet that get a dropdown. Comfortably covers a 5 MB upload. */
const VALIDATED_ROWS = 2000;

/** Ceiling on a fallback dropdown, so one messy column can't bloat the file. */
const MAX_FALLBACK_VALUES = 500;

/**
 * The values one column's dropdown should offer.
 *
 * Normally the approved list. When a vocabulary has no approved terms — a fresh
 * install, or `2026-07-28_company_data_quality.sql` not applied, which leaves
 * `vocab_terms` missing altogether — the template used to ship a dropdown whose
 * only entry was "(no company_type values configured yet)", so the column was
 * unusable in the very template meant to make it easy. Fall back to the values
 * companies already hold, which is the same rule the importer applies when it
 * bootstraps an empty vocabulary from an uploaded sheet.
 */
async function dropdownValues(kind: VocabKind, approved: string[]): Promise<string[]> {
  if (approved.length) return approved;

  // Column name comes from a fixed map, never from user input.
  const col = VOCAB_COLUMN[kind];
  const [rows] = await db.query(
    `SELECT TRIM(${col}) AS value
       FROM companies
      WHERE TRIM(COALESCE(${col}, '')) <> ''
      GROUP BY TRIM(${col})
      ORDER BY COUNT(*) DESC, value ASC
      LIMIT ${MAX_FALLBACK_VALUES}`
  );
  // Picked by how many companies use them, then listed alphabetically — which
  // is the order someone scrolling the dropdown in Excel expects.
  return (rows as any[])
    .map((r) => String(r.value ?? "").trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

/**
 * GET /api/companies/template
 *
 * Returns an .xlsx companies-import template with real Excel data-validation
 * dropdowns on the three columns that feed the app's filters — company_type,
 * segment and country. The values come from the live approved lists, so admins
 * never keep two lists in sync, and a typo is caught in Excel rather than
 * arriving as a new junk filter option.
 *
 * The valid values live on a hidden "Lists" sheet, one column each, rather than
 * inline in the data-validation formula — Excel caps inline list strings at 255
 * chars, which breaks once you have more than a handful of values.
 *
 * Staff-only (admins + moderators); same gate as the CSV upload.
 */
export async function GET() {
  const gate = await requireRole("staff");
  if ("response" in gate) return gate.response;

  const vocab = await loadVocabularies(db);
  const values = Object.fromEntries(
    await Promise.all(
      VOCAB_KINDS.map(async (k) => [k, await dropdownValues(k, vocab[k].terms)])
    )
  ) as Record<VocabKind, string[]>;

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
    // A company routinely has more than one usable number and inbox. The
    // columns and the importer have taken all three since
    // 2026-08-14_company_extra_contacts.sql; leaving them out of the template
    // meant nobody filling it in had anywhere to put the extras.
    "phone_main",
    "phone_main_2",
    "phone_main_3",
    "email_general",
    "email_general_2",
    "email_general_3",
    "linkedin",
    "facebook_url",
    "instagram_url",
    "notes",
    "company_profile",
    "financial_reports",
    "forecast_value",
  ];

  const wb = new ExcelJS.Workbook();
  wb.creator = "LeadSentra";
  wb.created = new Date();

  const ws = wb.addWorksheet("Companies");
  ws.addRow(headers);
  // Bold the header row so the template reads cleanly when opened.
  ws.getRow(1).font = { bold: true };
  ws.columns = headers.map((h) => ({ header: h, key: h, width: Math.max(14, h.length + 2) }));

  // Hidden lookup sheet holding the dropdown sources. Excel honours data
  // validations that reference another sheet by name, so each list gets its own
  // column there and the validation points at that range.
  const listSheet = wb.addWorksheet("Lists");
  listSheet.state = "veryHidden";

  let listCol = 0;
  for (const [header, kind] of Object.entries(VALIDATED_COLUMNS)) {
    const dataColIdx = headers.indexOf(header) + 1; // 1-based
    if (dataColIdx === 0) continue;

    listCol++;
    const letter = colLetter(listCol);
    const list = values[kind];
    if (list.length === 0) {
      // Without at least one value Excel drops the dropdown silently. Drop a
      // sentinel so the column still behaves consistently.
      listSheet.getCell(`${letter}1`).value = `(no ${header} values configured yet)`;
    } else {
      list.forEach((v, i) => {
        listSheet.getCell(`${letter}${i + 1}`).value = v;
      });
    }
    const ref = `Lists!$${letter}$1:$${letter}$${Math.max(list.length, 1)}`;

    const dataLetter = colLetter(dataColIdx);
    for (let r = 2; r <= VALIDATED_ROWS; r++) {
      ws.getCell(`${dataLetter}${r}`).dataValidation = {
        type: "list",
        allowBlank: true,
        formulae: [ref],
        showErrorMessage: true,
        // A warning, not a hard stop: a genuinely new value has to be able to
        // get in somehow. Anything typed past this prompt still imports — it is
        // held out of the filter dropdowns and listed under "Needs review"
        // until an admin approves it or maps it to an existing value.
        errorStyle: "warning",
        errorTitle: `Unrecognised ${header.replace(/_/g, " ")}`,
        error:
          `Pick a value from the list to keep the data consistent.\n\n` +
          `If this really is a new one, click Yes — it will import, but it ` +
          `won't be filterable until an admin approves it under Companies → Needs review.`,
      };
    }
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
