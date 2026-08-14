import * as XLSX from 'xlsx';

/**
 * .xlsx / .xls are ZIP or OLE containers whose text is already UTF-8 or
 * UTF-16 internally, so they're handed to SheetJS as bytes. A .csv is just
 * bytes with no declared encoding, and guessing wrong is what turns
 * "Aşkın İnci" into "A?k?n ?nci" — permanently, once it's saved.
 */
function looksBinary(bytes: Uint8Array): boolean {
  // "PK" = zip (xlsx). 0xD0CF = OLE compound file (legacy xls).
  return (
    (bytes[0] === 0x50 && bytes[1] === 0x4b) ||
    (bytes[0] === 0xd0 && bytes[1] === 0xcf)
  );
}

/**
 * Decodes a text spreadsheet, working out its encoding rather than assuming:
 *
 *   1. A UTF-8 BOM settles it — strip and decode.
 *   2. Otherwise try a STRICT UTF-8 decode. Real UTF-8 has a distinctive byte
 *      structure, so a strict decode that succeeds is near-conclusive.
 *   3. Failing that, fall back to windows-1252 — what Excel writes when
 *      "CSV (Comma delimited)" is chosen on a Western Windows machine.
 *
 * Without this, a CSV exported from Excel in a legacy codepage was read as
 * UTF-8, and every accented or non-Latin character was mangled on the way in.
 */
function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return new TextDecoder("utf-8").decode(bytes.subarray(3));
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // Not valid UTF-8 — treat it as the Windows default codepage.
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

/** Parses a spreadsheet buffer, choosing the binary or text path as needed. */
function readWorkbook(buffer: ArrayBuffer): XLSX.WorkBook {
  const bytes = new Uint8Array(buffer);
  if (looksBinary(bytes)) return XLSX.read(bytes, { type: "array" });
  return XLSX.read(decodeText(bytes), { type: "string", raw: false });
}

export function sheetToJson<T = Record<string, any>>(buffer: ArrayBuffer): T[] {
  const wb = readWorkbook(buffer);
  const first = wb.SheetNames[0];
  const ws = wb.Sheets[first];
  const rows = XLSX.utils.sheet_to_json<T>(ws, { defval: "" });
  return rows;
}

/**
 * Reads the first sheet as raw rows of cells, with NO row treated as a header.
 *
 * `sheetToJson` keys each row by the first row's values, which silently
 * swallows that row.  For a file that may legitimately have no header — an
 * "one email address per line" export, say — that would drop the first
 * address, so callers that need to decide for themselves take this instead.
 */
export function sheetToRows(buffer: ArrayBuffer): string[][] {
  const wb = readWorkbook(buffer);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: "", blankrows: false });
  return rows.map((r) => (Array.isArray(r) ? r.map((c) => (c == null ? "" : String(c))) : []));
}

export function chunk<T>(arr: T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
