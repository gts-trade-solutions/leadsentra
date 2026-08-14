import { NextResponse } from "next/server";
import { getUser } from "@/lib/auth";
import { sheetToRows } from "@/lib/excel";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/campaigns/recipients/parse   (multipart/form-data, field: "file")
 *
 * Parses an uploaded CSV / XLSX of email addresses into a clean, deduplicated
 * list the compose page can send as a one-off campaign audience.  Nothing is
 * written to the database here — the addresses only become
 * `campaign_recipients` rows when the campaign is actually created.
 *
 * Column detection: any header containing "email" / "e-mail" / "mail" wins.
 * A file with no recognizable header still works — we fall back to scanning
 * every cell for something that looks like an address, which is what a plain
 * "one address per line" .csv or .txt export looks like.  A first row that is
 * itself an address means the file has no header at all, so that row is data.
 *
 * Returns { emails, total, invalid, duplicates, invalidSamples }.
 */

// Hard ceiling on one upload.  Well above the 10k-address case this exists for,
// but low enough that a runaway file can't exhaust memory or produce a campaign
// nobody intended.
const MAX_EMAILS = 50_000;
// 10 MB — an .xlsx of 50k addresses is well under this.
const MAX_FILE_BYTES = 10 * 1024 * 1024;

// Deliberately permissive: SES is the real authority on deliverability, and
// over-strict client validation silently drops addresses users care about.
// This only rejects things that clearly are not addresses.
const EMAIL_RE = /^[^\s@,;]+@[^\s@,;.]+\.[^\s@,;]{2,}$/;

function looksLikeEmailColumn(header: string): boolean {
  const h = header.trim().toLowerCase();
  return h.includes("email") || h.includes("e-mail") || h === "mail";
}

export async function POST(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a multipart file upload" }, { status: 400 });
  }

  const file = form.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: `File is too large (max ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB)` },
      { status: 413 }
    );
  }

  let rows: string[][];
  try {
    rows = sheetToRows(await file.arrayBuffer());
  } catch (e: any) {
    return NextResponse.json(
      { error: `Could not read that file: ${e?.message || "unrecognized format"}` },
      { status: 400 }
    );
  }

  if (!rows.length) {
    return NextResponse.json({ error: "That file has no rows" }, { status: 400 });
  }

  // Decide whether row 0 is a header. If any of its cells is itself an address,
  // the file has no header and that row is data — dropping it would silently
  // lose the first recipient of a bare "one address per line" export.
  const headerRow = rows[0];
  const hasHeader = !headerRow.some((cell) => EMAIL_RE.test(cell.trim().toLowerCase()));
  const headers = hasHeader ? headerRow : [];
  const dataRows = hasHeader ? rows.slice(1) : rows;

  // Prefer the column(s) whose header names them as the email column;
  // otherwise scan every column.
  const emailColIdx = headers
    .map((h, i) => (looksLikeEmailColumn(h) ? i : -1))
    .filter((i) => i >= 0);
  const namedColumns = emailColIdx.length > 0;

  const seen = new Set<string>();
  const emails: string[] = [];
  const invalidSamples: string[] = [];
  let invalid = 0;
  let duplicates = 0;
  let truncated = false;

  outer: for (const row of dataRows) {
    const indices = namedColumns ? emailColIdx : row.map((_, i) => i);
    for (const idx of indices) {
      const raw = row[idx];
      if (raw === null || raw === undefined) continue;
      // One cell can hold several addresses ("a@x.com, b@y.com") — split on the
      // usual separators rather than discarding the whole cell as invalid.
      for (const piece of String(raw).split(/[,;\s]+/)) {
        const value = piece.trim().replace(/^[<"']+|[>"']+$/g, "").toLowerCase();
        if (!value) continue;
        // When scanning ALL columns (no email header), non-address cells like
        // names and phone numbers are expected — skip them silently instead of
        // reporting every one as invalid.
        if (!EMAIL_RE.test(value)) {
          if (namedColumns) {
            invalid++;
            if (invalidSamples.length < 10) invalidSamples.push(piece.trim().slice(0, 80));
          }
          continue;
        }
        if (seen.has(value)) {
          duplicates++;
          continue;
        }
        seen.add(value);
        emails.push(value);
        if (emails.length >= MAX_EMAILS) {
          truncated = true;
          break outer;
        }
      }
    }
  }

  return NextResponse.json({
    emails,
    total: emails.length,
    invalid,
    duplicates,
    invalidSamples,
    truncated,
    // Surfaced so the UI can tell the user which column it actually read.
    column: namedColumns ? emailColIdx.map((i) => headers[i]).join(", ") : null,
    maxEmails: MAX_EMAILS,
  });
}
