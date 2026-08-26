/**
 * Controlled vocabularies for the free-text company fields that feed the filter
 * dropdowns: company_type, segment and country.
 *
 * Bulk import used to write these columns through verbatim, so one spreadsheet
 * could introduce "Manufacturer", "Manutacture", "manufacturing" and
 * "MANUFACTURER " as four separate filter options for what is one type. This
 * module is the single place that decides what an uploaded value really means:
 *
 *   exact  - matches a canonical term (case/punctuation-insensitive)
 *   alias  - matches a mapping an admin (or a past auto-correction) recorded
 *   stem   - matches a term once common suffixes are stripped
 *            ("manufacturing" -> "manufactur" <- "Manufacturer")
 *   fuzzy  - within a small edit distance of exactly one term
 *            ("Manutacture" -> "Manufacturer", 2 edits over 12 chars)
 *   unknown- nothing close enough; the caller quarantines it for review
 *
 * Everything is compared on a normalised key, never on the raw string, and a
 * matched value is rewritten to the canonical spelling before it is stored —
 * that is what keeps the dropdowns to one option per real-world type.
 */

import { isPlaceholder } from "@/lib/validate";

export type VocabKind = "company_type" | "segment" | "country";

export const VOCAB_KINDS: VocabKind[] = ["company_type", "segment", "country"];

export const VOCAB_LABEL: Record<VocabKind, string> = {
  company_type: "Company type",
  segment: "Segment",
  country: "Country",
};

/** The `companies` column each vocabulary governs. */
export const VOCAB_COLUMN: Record<VocabKind, string> = {
  company_type: "company_type",
  segment: "segment",
  country: "country",
};

/**
 * Normalised comparison key: case-folded, de-accented, stripped of everything
 * that isn't a letter or digit. "P.T. Astra Motor" and "pt astra motor" both
 * become "ptastramotor".
 *
 * Scripts with no ASCII letters (Chinese, Arabic, …) would collapse to an empty
 * string and then all compare equal, so those fall back to the lower-cased
 * value instead.
 */
export function vocabKey(value: string): string {
  const stripped = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "");
  return stripped || value.trim().toLowerCase();
}

/**
 * Key with the usual English noun/verb endings removed, so the different forms
 * of one word land on the same stem: manufacture / manufacturer / manufacturers
 * / manufacturing -> "manufactur".
 *
 * Only applied to keys of 6+ chars, and never allowed to shorten a key below 4,
 * because stemming short words merges unrelated ones.
 */
export function stemKey(value: string): string {
  const key = vocabKey(value);
  if (key.length < 6) return key;
  let k = key.replace(/(?:es|s)$/, "");
  k = k.replace(/(?:ings?|ers?|ors?|ions?|ment|al)$/, "");
  k = k.replace(/e$/, "");
  return k.length >= 4 ? k : key;
}

/**
 * Optimal string alignment distance (Levenshtein plus adjacent transposition,
 * so "Mnaufacturer" costs 1, not 2). Returns `max + 1` as soon as the distance
 * is known to exceed `max` — callers only ever care about small distances.
 */
export function editDistance(a: string, b: string, max = 4): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev2: number[] = [];
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  let curr: number[] = new Array(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d = Math.min(d, prev2[j - 2] + 1);
      }
      curr[j] = d;
      if (d < rowMin) rowMin = d;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = curr;
    curr = new Array(b.length + 1);
  }
  return prev[b.length];
}

/** 1.0 = identical, 0.0 = nothing in common. */
export function similarity(a: string, b: string): number {
  const len = Math.max(a.length, b.length);
  if (!len) return 1;
  return 1 - editDistance(a, b, len) / len;
}

/**
 * How far a typo is allowed to be from a term before we stop guessing. Short
 * values get no leeway at all: "Bus" and "Bank" are 3 edits apart but very much
 * not the same segment.
 */
function maxEditsFor(keyLength: number): number {
  if (keyLength < 5) return 0;
  if (keyLength < 9) return 1;
  return 2;
}

const FUZZY_MIN_SCORE = 0.8;
/** Weakest match the review screen will still offer as a suggestion. */
const SUGGEST_MIN_SCORE = 0.55;

export type MatchStatus = "empty" | "exact" | "alias" | "stem" | "fuzzy" | "unknown";

export type VocabMatch = {
  /** What to store: the canonical spelling, or the trimmed raw value if unknown. */
  value: string | null;
  status: MatchStatus;
  /** The raw value as uploaded — set only when it differs from `value`. */
  from?: string;
  score?: number;
};

export type Vocabulary = {
  kind: VocabKind;
  /** Canonical terms in their display spelling. */
  terms: string[];
  byKey: Map<string, string>;
  byStem: Map<string, string>;
  aliases: Map<string, string>;
};

export function buildVocabulary(
  kind: VocabKind,
  terms: string[],
  aliases: Array<{ alias_key: string; canonical: string }> = []
): Vocabulary {
  const clean = Array.from(
    new Map(terms.map((t) => String(t ?? "").trim()).filter(Boolean).map((t) => [vocabKey(t), t])).values()
  );

  const byKey = new Map<string, string>();
  for (const t of clean) byKey.set(vocabKey(t), t);

  // A stem shared by two canonical terms tells us nothing, so drop it rather
  // than let it pick a winner arbitrarily.
  const stemCounts = new Map<string, string[]>();
  for (const t of clean) {
    const s = stemKey(t);
    stemCounts.set(s, [...(stemCounts.get(s) ?? []), t]);
  }
  const byStem = new Map<string, string>();
  for (const [s, list] of Array.from(stemCounts.entries())) {
    if (list.length === 1 && !byKey.has(s)) byStem.set(s, list[0]);
  }

  const aliasMap = new Map<string, string>();
  for (const a of aliases) {
    const canonical = byKey.get(vocabKey(a.canonical));
    // An alias pointing at a term that has since been renamed or deleted is
    // dead weight; ignore it instead of resurrecting the old spelling.
    if (canonical) aliasMap.set(a.alias_key, canonical);
  }

  return { kind, terms: clean, byKey, byStem, aliases: aliasMap };
}

/**
 * Best fuzzy candidate for `value`, or null. Requires a clear winner: if two
 * terms are equally close we would be guessing, and a wrong auto-correction is
 * worse than a value parked for review.
 */
function bestFuzzy(
  vocab: Vocabulary,
  key: string,
  maxEdits: number,
  minScore: number
): { term: string; score: number } | null {
  if (maxEdits <= 0) return null;

  let best: { term: string; score: number; dist: number } | null = null;
  let runnerUpDist = Infinity;

  for (const term of vocab.terms) {
    const tKey = vocabKey(term);
    const dist = editDistance(key, tKey, maxEdits);
    if (dist > maxEdits) continue;
    const score = 1 - dist / Math.max(key.length, tKey.length);
    if (score < minScore) continue;
    if (!best || dist < best.dist || (dist === best.dist && score > best.score)) {
      if (best) runnerUpDist = best.dist;
      best = { term, score, dist };
    } else if (dist < runnerUpDist) {
      runnerUpDist = dist;
    }
  }

  if (!best) return null;
  if (runnerUpDist === best.dist) return null; // ambiguous — two terms equally close
  return { term: best.term, score: best.score };
}

/** Resolve one uploaded cell against a vocabulary. */
export function resolveTerm(vocab: Vocabulary, raw: string | null | undefined): VocabMatch {
  const value = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!value || isPlaceholder(value)) return { value: null, status: "empty" };

  // No canonical list configured yet (fresh install, or the migration hasn't
  // run) — pass the value through untouched rather than flag every row.
  if (vocab.terms.length === 0) return { value, status: "exact" };

  const key = vocabKey(value);

  const exact = vocab.byKey.get(key);
  if (exact) {
    return exact === value
      ? { value: exact, status: "exact" }
      : { value: exact, status: "exact", from: value };
  }

  const alias = vocab.aliases.get(key);
  if (alias) return { value: alias, status: "alias", from: value };

  const stem = vocab.byStem.get(stemKey(value));
  if (stem) return { value: stem, status: "stem", from: value, score: similarity(key, vocabKey(stem)) };

  const fuzzy = bestFuzzy(vocab, key, maxEditsFor(key.length), FUZZY_MIN_SCORE);
  if (fuzzy) return { value: fuzzy.term, status: "fuzzy", from: value, score: fuzzy.score };

  return { value, status: "unknown" };
}

/**
 * Loose match used by the review screen to pre-fill "did you mean…". Wider than
 * {@link resolveTerm} on purpose: a human confirms it before anything changes.
 */
export function suggestTerm(vocab: Vocabulary, raw: string): string | null {
  const value = String(raw ?? "").trim();
  if (!value || vocab.terms.length === 0) return null;
  const key = vocabKey(value);

  const stem = vocab.byStem.get(stemKey(value));
  if (stem) return stem;

  let best: { term: string; score: number } | null = null;
  for (const term of vocab.terms) {
    const score = similarity(key, vocabKey(term));
    if (score >= SUGGEST_MIN_SCORE && (!best || score > best.score)) {
      best = { term, score };
    }
  }
  return best?.term ?? null;
}

/* ------------------------------------------------------------------ *
 * Loading                                                             *
 * ------------------------------------------------------------------ */

/** Minimal shape shared by the pool and a checked-out connection. */
type Queryable = { execute(sql: string, params?: any[]): Promise<any> };

/** True for "table doesn't exist" — the migration hasn't been applied yet. */
function isMissingTable(e: any): boolean {
  return e?.code === "ER_NO_SUCH_TABLE" || e?.errno === 1146;
}

async function selectTerms(conn: Queryable, kind: VocabKind): Promise<string[]> {
  try {
    // Segments predate this module and keep their own table, which the
    // Companies page and the .xlsx template already read.
    const [rows] =
      kind === "segment"
        ? await conn.execute("SELECT name FROM company_segments ORDER BY name ASC")
        : await conn.execute(
            "SELECT name FROM vocab_terms WHERE vocabulary = ? ORDER BY name ASC",
            [kind]
          );
    return (rows as any[]).map((r) => String(r.name ?? "").trim()).filter(Boolean);
  } catch (e) {
    if (isMissingTable(e)) return [];
    throw e;
  }
}

async function selectAliases(
  conn: Queryable
): Promise<Record<string, Array<{ alias_key: string; canonical: string }>>> {
  try {
    const [rows] = await conn.execute(
      "SELECT vocabulary, alias_key, canonical FROM vocab_aliases"
    );
    const out: Record<string, Array<{ alias_key: string; canonical: string }>> = {};
    for (const r of rows as any[]) {
      const v = String(r.vocabulary);
      (out[v] ||= []).push({
        alias_key: String(r.alias_key),
        canonical: String(r.canonical),
      });
    }
    return out;
  } catch (e) {
    if (isMissingTable(e)) return {};
    throw e;
  }
}

export type VocabSet = Record<VocabKind, Vocabulary>;

/** Load every vocabulary in two queries plus one per kind. */
export async function loadVocabularies(conn: Queryable): Promise<VocabSet> {
  const aliases = await selectAliases(conn);
  const entries = await Promise.all(
    VOCAB_KINDS.map(async (kind) => {
      const terms = await selectTerms(conn, kind);
      return [kind, buildVocabulary(kind, terms, aliases[kind] ?? [])] as const;
    })
  );
  return Object.fromEntries(entries) as VocabSet;
}

/**
 * Add a term to whichever table backs `kind`. Idempotent.
 *
 * Silently does nothing if the table isn't there yet: the code can be deployed
 * before 2026-07-28_company_data_quality.sql is applied, and an import must not
 * fail over bookkeeping.
 */
export async function insertTerm(
  conn: Queryable,
  kind: VocabKind,
  name: string,
  userId: string | null
): Promise<void> {
  try {
    if (kind === "segment") {
      await conn.execute(
        "INSERT IGNORE INTO company_segments (name, created_by) VALUES (?, ?)",
        [name, userId]
      );
      return;
    }
    await conn.execute(
      "INSERT IGNORE INTO vocab_terms (vocabulary, name, created_by) VALUES (?, ?, ?)",
      [kind, name, userId]
    );
  } catch (e) {
    if (!isMissingTable(e)) throw e;
  }
}

/**
 * Remove a term from whichever table backs `kind`. Idempotent.
 *
 * This only takes the value out of the list — what happens to companies still
 * holding it is the caller's decision. The "delete" action in
 * /api/companies/vocab clears the column first, so a deleted value is never
 * left sitting on a company where nothing on any list explains it.
 *
 * Same missing-table tolerance as insertTerm.
 */
export async function deleteTerm(
  conn: Queryable,
  kind: VocabKind,
  name: string
): Promise<void> {
  try {
    if (kind === "segment") {
      await conn.execute("DELETE FROM company_segments WHERE name = ?", [name]);
      return;
    }
    await conn.execute(
      "DELETE FROM vocab_terms WHERE vocabulary = ? AND name = ?",
      [kind, name]
    );
  } catch (e) {
    if (!isMissingTable(e)) throw e;
  }
}

/**
 * Point the mappings that led to `from` at `to` instead.
 *
 * Used when two approved terms are merged: the losing spelling leaves the list,
 * but everything the importer already learned about reaching it is still
 * correct — it just needs to arrive at the surviving term now. Deleting those
 * aliases instead would throw away the corrections and let the same
 * misspellings come back through the next upload.
 */
export async function repointAliases(
  conn: Queryable,
  kind: VocabKind,
  from: string,
  to: string
): Promise<void> {
  try {
    await conn.execute(
      "UPDATE vocab_aliases SET canonical = ? WHERE vocabulary = ? AND canonical = ?",
      [to, kind, from]
    );
  } catch (e) {
    if (!isMissingTable(e)) throw e;
  }
}

/**
 * Drop the mappings that pointed at a term being deleted.
 *
 * buildVocabulary already ignores an alias whose canonical is gone, so this
 * isn't what stops the old spelling coming back. It stops dead rows piling up,
 * and stops a later term that happens to reuse the name silently inheriting
 * mappings that were decided about a different one.
 */
export async function deleteAliasesTo(
  conn: Queryable,
  kind: VocabKind,
  canonical: string
): Promise<void> {
  try {
    await conn.execute(
      "DELETE FROM vocab_aliases WHERE vocabulary = ? AND canonical = ?",
      [kind, canonical]
    );
  } catch (e) {
    if (!isMissingTable(e)) throw e;
  }
}

/**
 * Remember that `from` means `to`, so the next upload of that spelling is
 * corrected without anyone looking at it. `source` distinguishes a mapping a
 * human confirmed from one the importer inferred.
 */
export async function recordAlias(
  conn: Queryable,
  kind: VocabKind,
  from: string,
  to: string,
  source: "auto" | "manual",
  userId: string | null
): Promise<void> {
  const key = vocabKey(from);
  if (!key || key === vocabKey(to)) return;
  try {
    await conn.execute(
      `INSERT INTO vocab_aliases (vocabulary, alias_key, alias_raw, canonical, source, created_by)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       canonical = VALUES(canonical),
       -- A human decision outranks whatever the importer guessed earlier.
       source    = IF(VALUES(source) = 'manual', 'manual', source),
       alias_raw = VALUES(alias_raw)`,
      [kind, key, from.slice(0, 128), to, source, userId]
    );
  } catch (e) {
    // Same as insertTerm: tolerate the migration not having run yet.
    if (!isMissingTable(e)) throw e;
  }
}
