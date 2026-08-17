-- Seed the approved company_type / country lists from the values already in use.
--
-- 2026-07-28_company_data_quality.sql seeds a spelling only once @MIN_ROWS (3)
-- or more companies share it. That threshold is there to stop a one-off typo
-- being blessed as canonical, and it is the right rule for a large messy
-- import — but on a small table it approves almost nothing: with 25 companies
-- holding 19 distinct types, only "Manufacturer" clears the bar, so the filter
-- and template dropdowns end up offering one option out of nineteen real ones.
--
-- This approves every distinct value currently stored instead. The values are
-- descriptive types entered deliberately, not typos, so the useful cleanup here
-- is merging near-duplicates ("Automotive Manufacturer" into "Manufacturer",
-- say) — which is exactly what Companies -> Needs review does, and it can only
-- offer that once the terms exist.
--
-- Run AFTER 2026-07-28_company_data_quality.sql, which creates vocab_terms.
-- Idempotent: INSERT IGNORE, so re-running adds only what is new.
--
--   node scripts/apply-sql.mjs migrations/2026-08-17_seed_company_vocab.sql
--
-- Segments are deliberately left alone: company_segments is a curated list of
-- 12 and already covers every value the companies table uses.

-- ---------------------------------------------------------------------
-- 1. Collect the distinct spellings, case-SENSITIVELY.
--
--    companies.company_type is utf8mb4_0900_ai_ci, so a plain GROUP BY folds
--    'Manufacturer' and 'manufacturer' together and we lose the ability to
--    count which spelling is the popular one. CAST(... AS BINARY) keeps them
--    apart, exactly as the 2026-07-28 migration does.
-- ---------------------------------------------------------------------
DROP TEMPORARY TABLE IF EXISTS _seed_raw;
CREATE TEMPORARY TABLE _seed_raw (
  vocabulary VARCHAR(32)    NOT NULL,
  raw        VARBINARY(512) NOT NULL,
  n          INT            NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO _seed_raw (vocabulary, raw, n)
SELECT 'company_type', CAST(TRIM(company_type) AS BINARY), COUNT(*)
FROM companies
WHERE TRIM(COALESCE(company_type, '')) <> ''
GROUP BY CAST(TRIM(company_type) AS BINARY);

INSERT INTO _seed_raw (vocabulary, raw, n)
SELECT 'country', CAST(TRIM(country) AS BINARY), COUNT(*)
FROM companies
WHERE TRIM(COALESCE(country, '')) <> ''
GROUP BY CAST(TRIM(country) AS BINARY);

-- ---------------------------------------------------------------------
-- 2. One winner per case-insensitive group: the spelling most companies use.
--    Approving both 'Truck' and 'truck' would put the same value in the
--    dropdown twice.
-- ---------------------------------------------------------------------
DROP TEMPORARY TABLE IF EXISTS _seed_ranked;
CREATE TEMPORARY TABLE _seed_ranked (
  vocabulary VARCHAR(32)  NOT NULL,
  name       VARCHAR(512) NOT NULL,
  rn         INT          NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO _seed_ranked (vocabulary, name, rn)
SELECT vocabulary,
       CONVERT(raw USING utf8mb4),
       ROW_NUMBER() OVER (PARTITION BY vocabulary, LOWER(CONVERT(raw USING utf8mb4))
                          ORDER BY n DESC, raw ASC)
FROM _seed_raw;

INSERT IGNORE INTO vocab_terms (vocabulary, name)
SELECT vocabulary, name
FROM _seed_ranked
WHERE rn = 1
  AND CHAR_LENGTH(name) <= 128;

DROP TEMPORARY TABLE IF EXISTS _seed_raw;
DROP TEMPORARY TABLE IF EXISTS _seed_ranked;

-- ---------------------------------------------------------------------
-- 3. Report - what the dropdowns will now offer. Read-only.
-- ---------------------------------------------------------------------
SELECT vocabulary, COUNT(*) AS approved_terms
FROM vocab_terms
GROUP BY vocabulary;
