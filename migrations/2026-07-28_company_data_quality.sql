-- Controlled vocabularies + duplicate detection for imported company data.
--
-- Problem this solves: bulk import wrote company_type / segment / country
-- straight through, so every spelling mistake in a spreadsheet became its own
-- option in the filter dropdowns ("Manufacturer", "Manutacture",
-- "manufacturing", "MANUFACTURER "), and a re-uploaded sheet inserted every
-- row again because company_id defaulted to a fresh UUID.
--
-- What this migration adds:
--   1. vocab_terms    - the approved values for company_type and country
--                       (segments keep their existing company_segments table)
--   2. vocab_aliases  - "this misspelling means that term", so a correction
--                       made once is applied automatically on every later upload
--   3. companies.name_key - punctuation/case-insensitive name, indexed, so the
--                       importer can find the row a sheet is re-describing
--   4. A one-off clean of the values already stored.
--
-- Run against the `leadsentra` database. Take a backup first:
--   mysqldump -u root -p leadsentra companies > companies_backup_2026-07-28.sql
--
-- Apply with:  node scripts/apply-sql.mjs migrations/2026-07-28_company_data_quality.sql

-- How many rows a spelling needs before it is trusted as a real term rather
-- than treated as a typo to review. Raise it if the existing data is messier.
SET @MIN_ROWS := 3;

-- ---------------------------------------------------------------------
-- 1. Vocabulary tables
--
--    Collation is pinned to utf8mb4_unicode_ci so the tables are identical on
--    every install. The companies columns are NOT necessarily in that
--    collation (this database has them in utf8mb4_0900_ai_ci), and comparing
--    two different collations fails with
--      ERROR 1267: Illegal mix of collations for operation '='
--    so every join below puts an explicit COLLATE on the companies side. An
--    explicit collation outranks a column's own, which settles the comparison
--    whichever collation the column happens to use.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS vocab_terms (
  vocabulary  VARCHAR(32)  NOT NULL,   -- 'company_type' | 'country'
  name        VARCHAR(128) NOT NULL,   -- canonical spelling, as displayed
  created_by  CHAR(36)     NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (vocabulary, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vocab_aliases (
  vocabulary  VARCHAR(32)  NOT NULL,
  -- Normalised form of the wrong spelling: lower-cased, accents and every
  -- non-alphanumeric character removed. Matches lib/vocab.ts vocabKey().
  alias_key   VARCHAR(128) NOT NULL,
  alias_raw   VARCHAR(128) NOT NULL,   -- what was actually typed, for display
  canonical   VARCHAR(128) NOT NULL,   -- the vocab_terms / company_segments name
  -- 'manual' = a human confirmed it in the review screen and it must never be
  -- silently overwritten by a later guess.
  source      ENUM('auto','manual') NOT NULL DEFAULT 'manual',
  created_by  CHAR(36)     NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (vocabulary, alias_key),
  KEY idx_vocab_aliases_canonical (vocabulary, canonical)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- 2. Seed the vocabularies from what is already stored.
--
--    A spelling used by @MIN_ROWS or more companies is taken to be real; the
--    long tail of one-off spellings is left out deliberately so it surfaces in
--    the "Needs review" screen instead of being blessed as canonical.
--
--    Grouping is done on CAST(... AS BINARY) because the column collation is
--    case-insensitive: without the cast MySQL folds 'Manufacturer' and
--    'manufacturer' into one row and we lose the ability to count which
--    spelling is the popular one.
-- ---------------------------------------------------------------------
DROP TEMPORARY TABLE IF EXISTS _vocab_raw;
CREATE TEMPORARY TABLE _vocab_raw (
  vocabulary VARCHAR(32)    NOT NULL,
  raw        VARBINARY(512) NOT NULL,
  n          INT            NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO _vocab_raw (vocabulary, raw, n)
SELECT 'company_type', CAST(TRIM(company_type) AS BINARY), COUNT(*)
FROM companies
WHERE TRIM(COALESCE(company_type, '')) <> ''
GROUP BY CAST(TRIM(company_type) AS BINARY);

INSERT INTO _vocab_raw (vocabulary, raw, n)
SELECT 'country', CAST(TRIM(country) AS BINARY), COUNT(*)
FROM companies
WHERE TRIM(COALESCE(country, '')) <> ''
GROUP BY CAST(TRIM(country) AS BINARY);

INSERT INTO _vocab_raw (vocabulary, raw, n)
SELECT 'segment', CAST(TRIM(segment) AS BINARY), COUNT(*)
FROM companies
WHERE TRIM(COALESCE(segment, '')) <> ''
GROUP BY CAST(TRIM(segment) AS BINARY);

-- Rank the spellings within each case-insensitive group: rn = 1 is the one
-- used by the most companies, group_n is how many companies the whole group
-- covers. The ranking is what stops 'Truck' and 'truck' both being approved.
DROP TEMPORARY TABLE IF EXISTS _vocab_ranked;
CREATE TEMPORARY TABLE _vocab_ranked (
  vocabulary VARCHAR(32)  NOT NULL,
  name       VARCHAR(512) NOT NULL,
  group_n    INT          NOT NULL,
  rn         INT          NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO _vocab_ranked (vocabulary, name, group_n, rn)
SELECT vocabulary,
       CONVERT(raw USING utf8mb4),
       SUM(n)       OVER (PARTITION BY vocabulary, LOWER(CONVERT(raw USING utf8mb4))),
       ROW_NUMBER() OVER (PARTITION BY vocabulary, LOWER(CONVERT(raw USING utf8mb4))
                          ORDER BY n DESC, raw ASC)
FROM _vocab_raw;

INSERT IGNORE INTO vocab_terms (vocabulary, name)
SELECT vocabulary, name
FROM _vocab_ranked
WHERE vocabulary IN ('company_type', 'country')
  AND rn = 1
  AND group_n >= @MIN_ROWS
  AND CHAR_LENGTH(name) <= 128;

-- Segments already have a curated list of their own; top up from rows that
-- predate it, on the same evidence threshold. INSERT IGNORE means a curated
-- spelling always wins over whatever the data happens to use most.
INSERT IGNORE INTO company_segments (name)
SELECT name
FROM _vocab_ranked
WHERE vocabulary = 'segment'
  AND rn = 1
  AND group_n >= @MIN_ROWS
  AND CHAR_LENGTH(name) <= 64;

DROP TEMPORARY TABLE IF EXISTS _vocab_raw;
DROP TEMPORARY TABLE IF EXISTS _vocab_ranked;

-- ---------------------------------------------------------------------
-- 3. Rewrite stored values to the canonical spelling.
--
--    The column collation is case-insensitive, so joining on `= t.name`
--    matches every casing, and the UPDATE then rewrites them all to the one
--    spelling the dropdown shows. Typos are NOT touched here — they need a
--    human decision, which the Needs-review screen collects.
--
--    Every "has this actually changed?" test uses CAST(... AS BINARY):
--    utf8mb4_unicode_ci considers 'MANUFACTURER' and 'Manufacturer' equal, and
--    being a PAD SPACE collation it considers 'Truck ' and 'Truck' equal too,
--    so a plain `<>` would filter out exactly the rows we came to fix.
-- ---------------------------------------------------------------------
UPDATE companies c
JOIN vocab_terms t
  ON t.vocabulary = 'company_type'
 AND t.name = TRIM(c.company_type) COLLATE utf8mb4_unicode_ci
SET c.company_type = t.name
WHERE CAST(c.company_type AS BINARY) <> CAST(t.name AS BINARY);

UPDATE companies c
JOIN vocab_terms t
  ON t.vocabulary = 'country'
 AND t.name = TRIM(c.country) COLLATE utf8mb4_unicode_ci
SET c.country = t.name
WHERE CAST(c.country AS BINARY) <> CAST(t.name AS BINARY);

UPDATE companies c
JOIN company_segments s
  ON s.name = TRIM(c.segment) COLLATE utf8mb4_unicode_ci
SET c.segment = s.name
WHERE CAST(c.segment AS BINARY) <> CAST(s.name AS BINARY);

-- Stray whitespace, and cells holding an empty string, on values that have no
-- canonical term yet. An empty string is not the same as NULL to the filter
-- dropdowns — it shows up as a blank option.
UPDATE companies
SET company_type = NULLIF(TRIM(company_type), ''),
    country      = NULLIF(TRIM(country), ''),
    segment      = NULLIF(TRIM(segment), '')
WHERE CAST(COALESCE(company_type, '') AS BINARY) <> CAST(COALESCE(TRIM(company_type), '') AS BINARY)
   OR CAST(COALESCE(country, '')      AS BINARY) <> CAST(COALESCE(TRIM(country), '')      AS BINARY)
   OR CAST(COALESCE(segment, '')      AS BINARY) <> CAST(COALESCE(TRIM(segment), '')      AS BINARY)
   OR TRIM(company_type) = ''
   OR TRIM(country)      = ''
   OR TRIM(segment)      = '';

-- ---------------------------------------------------------------------
-- 4. Duplicate detection support.
--
--    name_key is the company name with case and punctuation removed, so
--    "P.T. Astra Motor", "PT Astra Motor" and "pt astra motor" share a key.
--    The importer looks a sheet's rows up by (name_key, country) to decide
--    update-vs-insert.
--
--    STORED (not VIRTUAL) so it can be indexed for that lookup; adding it
--    rebuilds the table, so expect a pause on a large companies table.
-- ---------------------------------------------------------------------
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME   = 'companies'
                AND COLUMN_NAME  = 'name_key');
SET @sql := IF(@col = 0,
  'ALTER TABLE companies
     ADD COLUMN name_key VARCHAR(255)
       GENERATED ALWAYS AS (REGEXP_REPLACE(LOWER(company_name), ''[^[:alnum:]]+'', '''')) STORED,
     ADD KEY idx_companies_name_key (name_key)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- The importer never used to populate `domain`, which is the strongest signal
-- that two rows are the same company. Backfill it from the website, and index
-- company_type for the review screen's per-value counts.
UPDATE companies
SET domain = LOWER(
      SUBSTRING_INDEX(
        SUBSTRING_INDEX(
          REGEXP_REPLACE(website, '^[a-zA-Z]+://', ''),
        '/', 1),
      ':', 1)
    )
WHERE (domain IS NULL OR domain = '')
  AND website IS NOT NULL
  AND website <> '';

UPDATE companies SET domain = REGEXP_REPLACE(domain, '^www\\.', '')
WHERE domain LIKE 'www.%';

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME   = 'companies'
                AND INDEX_NAME   = 'idx_companies_company_type');
SET @sql := IF(@idx = 0,
  'ALTER TABLE companies ADD KEY idx_companies_company_type (company_type)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------
-- 5. Report - what is left for a human to decide.
--
--    Everything below is read-only. The same information is available in the
--    app under Companies -> "Needs review", which can act on it in one click;
--    these queries are here so the migration can be sanity-checked from a
--    shell before anyone opens the UI.
-- ---------------------------------------------------------------------

-- 5a. Company types not in the approved list, commonest first.
SELECT c.company_type AS unapproved_value, COUNT(*) AS companies
FROM companies c
LEFT JOIN vocab_terms t
  ON t.vocabulary = 'company_type'
 AND t.name = TRIM(c.company_type) COLLATE utf8mb4_unicode_ci
WHERE TRIM(COALESCE(c.company_type, '')) <> '' AND t.name IS NULL
GROUP BY c.company_type
ORDER BY companies DESC;

-- 5b. Countries not in the approved list.
SELECT c.country AS unapproved_value, COUNT(*) AS companies
FROM companies c
LEFT JOIN vocab_terms t
  ON t.vocabulary = 'country'
 AND t.name = TRIM(c.country) COLLATE utf8mb4_unicode_ci
WHERE TRIM(COALESCE(c.country, '')) <> '' AND t.name IS NULL
GROUP BY c.country
ORDER BY companies DESC;

-- 5c. Companies stored more than once under the same normalised name.
SELECT name_key, COUNT(*) AS copies,
       GROUP_CONCAT(DISTINCT company_name SEPARATOR ' | ') AS spellings
FROM companies
WHERE name_key <> ''
GROUP BY name_key
HAVING copies > 1
ORDER BY copies DESC
LIMIT 200;
