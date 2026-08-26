import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUser } from "@/lib/auth";
import { isStaff } from "@/lib/admin";
import { gateDelete, pendingDeleteResponse } from "@/lib/deleteRequests";
import {
  loadVocabularies,
  resolveTerm,
  suggestTerm,
  recordAlias,
  insertTerm,
  deleteTerm,
  deleteAliasesTo,
  repointAliases,
  vocabKey,
  stemKey,
  similarity,
  VOCAB_KINDS,
  VOCAB_LABEL,
  VOCAB_COLUMN,
  type VocabKind,
  type Vocabulary,
} from "@/lib/vocab";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The approved-values screen behind the Companies page's "Needs review" button.
 *
 * GET  /api/companies/vocab
 *   -> { terms }                       for any signed-in user (feeds the filter
 *                                      dropdowns, so they only ever offer real
 *                                      values)
 *   -> { terms, review, duplicates, usage }
 *                                      for staff, where `review` is every value
 *                                      stored on a company that isn't an
 *                                      approved term — each with a suggested
 *                                      mapping — `duplicates` is approved
 *                                      terms that look like each other, and
 *                                      `usage` counts the companies sitting on
 *                                      each approved term, so the lists screen
 *                                      can say what deleting one would clear.
 *
 * POST /api/companies/vocab   staff only
 *   { kind, action: "map",     from: string[], to: string }
 *   { kind, action: "approve", from: string[] }
 *   { kind, action: "clear",   from: string[] }
 *   { kind, action: "delete",  from: string[] }
 *
 * Nothing here is derived from a stored queue: `review` is recomputed from the
 * companies table on every request, so it also surfaces junk that predates the
 * importer's validation, and it empties out as values are mapped.
 */

type ValueCount = { value: string; rows: number };

/**
 * Distinct stored values with row counts, grouped case-SENSITIVELY.
 *
 * The column collation (utf8mb4_unicode_ci) treats 'Manufacturer' and
 * 'manufacturer' as one value and, being PAD SPACE, ignores trailing blanks —
 * which would hide precisely the variants this screen exists to show. COLLATE
 * utf8mb4_bin on both the select and the GROUP BY keeps them apart.
 */
async function distinctValues(kind: VocabKind): Promise<ValueCount[]> {
  const col = VOCAB_COLUMN[kind];
  const [rows] = await db.query(
    `SELECT TRIM(${col}) COLLATE utf8mb4_bin AS value, COUNT(*) AS n
       FROM companies
      WHERE TRIM(COALESCE(${col}, '')) <> ''
      GROUP BY TRIM(${col}) COLLATE utf8mb4_bin
      ORDER BY n DESC`
  );
  return (rows as any[]).map((r) => ({
    value: String(r.value),
    rows: Number(r.n) || 0,
  }));
}

type ReviewRow = {
  kind: VocabKind;
  field: string;
  value: string;
  rows: number;
  suggestion: string | null;
  /** high = we are fairly sure what this is; low = a guess; none = no idea. */
  confidence: "high" | "low" | "none";
  reason: string;
};

function reviewFor(vocab: Vocabulary, kind: VocabKind, values: ValueCount[]): ReviewRow[] {
  const out: ReviewRow[] = [];
  for (const { value, rows } of values) {
    const m = resolveTerm(vocab, value);
    if (m.status === "empty") continue;
    // Already exactly right — nothing to do.
    if (m.status === "exact" && m.value === value) continue;

    if (m.status === "exact") {
      out.push({
        kind, field: VOCAB_LABEL[kind], value, rows,
        suggestion: m.value,
        confidence: "high",
        reason: "Same term, different spacing or capitalisation",
      });
    } else if (m.status === "alias" || m.status === "stem" || m.status === "fuzzy") {
      out.push({
        kind, field: VOCAB_LABEL[kind], value, rows,
        suggestion: m.value,
        confidence: "high",
        reason:
          m.status === "alias"
            ? "Previously mapped to this term"
            : `Looks like a misspelling of "${m.value}"`,
      });
    } else {
      const guess = suggestTerm(vocab, value);
      out.push({
        kind, field: VOCAB_LABEL[kind], value, rows,
        suggestion: guess,
        confidence: guess ? "low" : "none",
        reason: guess ? `Possibly "${guess}"` : "Not in the approved list",
      });
    }
  }
  return out;
}

/** Approved terms similar enough that one of them is probably a mistake. */
function duplicateTerms(vocab: Vocabulary, kind: VocabKind, counts: Map<string, number>) {
  const pairs: Array<{ kind: VocabKind; field: string; a: string; b: string; aRows: number; bRows: number }> = [];
  const terms = vocab.terms;
  for (let i = 0; i < terms.length; i++) {
    for (let j = i + 1; j < terms.length; j++) {
      // Either near-identical spellings, or two forms of the same word
      // ("Truck" / "Trucks", "Distributor" / "Distribution").
      const score = similarity(vocabKey(terms[i]), vocabKey(terms[j]));
      if (score < 0.8 && stemKey(terms[i]) !== stemKey(terms[j])) continue;
      pairs.push({
        kind,
        field: VOCAB_LABEL[kind],
        a: terms[i],
        b: terms[j],
        aRows: counts.get(terms[i].toLowerCase()) ?? 0,
        bRows: counts.get(terms[j].toLowerCase()) ?? 0,
      });
    }
  }
  return pairs;
}

export async function GET() {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const vocab = await loadVocabularies(db);
  const terms = Object.fromEntries(
    VOCAB_KINDS.map((k) => [k, vocab[k].terms])
  ) as Record<VocabKind, string[]>;

  // The dropdowns need `terms` and nothing else; the counting queries below
  // scan the whole companies table, so non-staff stop here.
  if (!isStaff(session.role)) return NextResponse.json({ terms });

  const review: ReviewRow[] = [];
  const duplicates: ReturnType<typeof duplicateTerms> = [];
  const usage = {} as Record<VocabKind, Record<string, number>>;

  for (const kind of VOCAB_KINDS) {
    const values = await distinctValues(kind);
    review.push(...reviewFor(vocab[kind], kind, values));

    const counts = new Map<string, number>();
    for (const v of values) {
      const k = v.value.toLowerCase();
      counts.set(k, (counts.get(k) ?? 0) + v.rows);
    }
    duplicates.push(...duplicateTerms(vocab[kind], kind, counts));

    // Companies sitting on each approved term. Counted case-insensitively,
    // matching what a delete would actually clear (its UPDATE compares under
    // the column's own case-insensitive collation).
    usage[kind] = Object.fromEntries(
      vocab[kind].terms.map((t) => [t, counts.get(t.toLowerCase()) ?? 0])
    );
  }

  review.sort((a, b) => b.rows - a.rows);
  return NextResponse.json({ terms, review, duplicates, usage });
}

export async function POST(req: Request) {
  const session = await getUser();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isStaff(session.role)) {
    return NextResponse.json({ error: "Staff only" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const kind = String(body?.kind ?? "") as VocabKind;
  const action = String(body?.action ?? "");
  const from = (Array.isArray(body?.from) ? body.from : [])
    .map((v: any) => String(v ?? "").trim())
    .filter(Boolean);
  const to = String(body?.to ?? "").trim();

  if (!VOCAB_KINDS.includes(kind)) {
    return NextResponse.json({ error: "Unknown field" }, { status: 400 });
  }
  if (!from.length) {
    return NextResponse.json({ error: "Nothing selected" }, { status: 400 });
  }
  const maxLen = kind === "segment" ? 64 : 128;
  if (action === "map" && (!to || to.length > maxLen)) {
    return NextResponse.json(
      { error: to ? `Value too long (max ${maxLen} chars)` : "A target value is required" },
      { status: 400 }
    );
  }
  if (action === "approve" && from.some((v: string) => v.length > maxLen)) {
    return NextResponse.json(
      { error: `Value too long (max ${maxLen} chars)` },
      { status: 400 }
    );
  }

  const col = VOCAB_COLUMN[kind];
  const conn = await db.getConnection();
  let changed = 0;

  try {
    await conn.beginTransaction();

    // The IN list must match case-sensitively: mapping 'manufacturer' should
    // not silently rewrite the rows that already say 'Manufacturer'.
    const inList = from.map(() => "?").join(", ");
    const whereValues = `TRIM(${col}) COLLATE utf8mb4_bin IN (${inList})`;

    if (action === "map") {
      const vocab = await loadVocabularies(conn);
      const known = vocab[kind].byKey.get(vocabKey(to));
      const canonical = known ?? to;
      // Mapping onto a value that isn't approved yet promotes it — otherwise
      // the rows would move and still be flagged for review.
      if (!known) await insertTerm(conn, kind, canonical, session.id);

      const [res]: any = await conn.query(
        `UPDATE companies SET ${col} = ? WHERE ${whereValues}`,
        [canonical, ...from]
      );
      changed = Number(res?.affectedRows) || 0;

      for (const f of from) {
        await recordAlias(conn, kind, f, canonical, "manual", session.id);
      }

      // Merging two APPROVED terms has to take the losing spelling OFF the
      // list. Rewriting the companies alone left both names approved, so the
      // pair came straight back under "Approved values that look alike" on the
      // next load — the merge moved every row and still looked like it had
      // done nothing.
      //
      // Only values that are themselves approved terms are removed. Mapping a
      // misspelling that was never on the list (the "Needs review" rows) has
      // nothing to take off it.
      for (const f of from) {
        const loser = vocab[kind].byKey.get(vocabKey(f));
        if (!loser || vocabKey(loser) === vocabKey(canonical)) continue;
        await deleteTerm(conn, kind, loser);
        // What the importer learned about reaching the losing spelling now
        // leads to the survivor instead of to a term that no longer exists.
        await repointAliases(conn, kind, loser, canonical);
      }
    } else if (action === "approve") {
      const vocab = await loadVocabularies(conn);
      for (const f of from) {
        // "Keep" on something that is only a capitalisation of a term already
        // on the list means adopt that term's spelling — approving both would
        // put the same value in the dropdown twice.
        const existing = vocab[kind].byKey.get(vocabKey(f));
        const canonical = existing ?? f;
        if (!existing) await insertTerm(conn, kind, canonical, session.id);
        // Fold every casing/spacing variant onto the approved spelling. The
        // comparison is the column's own case-insensitive collation, which is
        // exactly the set of rows that should end up sharing one spelling.
        const [res]: any = await conn.query(
          `UPDATE companies SET ${col} = ? WHERE TRIM(${col}) = ?`,
          [canonical, f]
        );
        changed += Number(res?.affectedRows) || 0;
      }
    } else if (action === "clear") {
      const [res]: any = await conn.query(
        `UPDATE companies SET ${col} = NULL WHERE ${whereValues}`,
        from
      );
      changed = Number(res?.affectedRows) || 0;
    } else if (action === "delete") {
      // Removing a value from a list is a delete of shared data — it changes
      // every company holding it — so an admin asks and a super admin decides.
      // One request per value, so each can be approved on its own merits.
      // `finally` below releases the connection, so we only roll back here.
      let pending: Awaited<ReturnType<typeof gateDelete>> | null = null;
      for (const f of from) {
        const g = await gateDelete(session, {
          resource: "list_value",
          id: f,
          label: `${VOCAB_LABEL[kind]}: ${f}`,
          payload: { kind },
        });
        if (!g.allowed && !pending) pending = g;
      }
      if (pending && !pending.allowed) {
        await conn.rollback();
        return pendingDeleteResponse(pending);
      }

      for (const f of from) {
        // Clear the field on every company holding the value BEFORE dropping
        // the term. Leaving the rows alone would only park the value back in
        // "Needs review" as an unapproved value on the next load, so deleting
        // it from the list would appear not to have worked.
        //
        // The comparison is the column's own case-insensitive collation — the
        // same set of rows `approve` folds together — so a value stored as
        // "manufacturer" is cleared by deleting "Manufacturer".
        const [res]: any = await conn.query(
          `UPDATE companies SET ${col} = NULL WHERE TRIM(${col}) = ?`,
          [f]
        );
        changed += Number(res?.affectedRows) || 0;
        await deleteTerm(conn, kind, f);
        await deleteAliasesTo(conn, kind, f);
      }
    } else {
      await conn.rollback();
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }

    await conn.commit();
  } catch (e: any) {
    await conn.rollback();
    return NextResponse.json(
      { error: e?.message || "Could not apply the change" },
      { status: 500 }
    );
  } finally {
    conn.release();
  }

  return NextResponse.json({ ok: true, changed });
}
