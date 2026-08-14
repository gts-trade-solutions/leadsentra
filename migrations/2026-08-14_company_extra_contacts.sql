-- ---------------------------------------------------------------------
-- Companies: additional email addresses and phone numbers.
--
-- A company routinely has more than one usable contact point — a general
-- inbox plus sales, a switchboard plus a direct line — and until now only
-- one of each could be stored, so the rest lived in the notes field where
-- nothing could search or use them.
--
-- Numbered columns rather than a child table, deliberately: the CSV import
-- and export stay flat and human-editable, which is how this data actually
-- arrives and leaves. Two extras of each cover the observed cases; adding
-- _4 later is the same one-line pattern.
--
-- Guarded + idempotent (safe to re-run).
--
-- Apply with:
--   node scripts/apply-sql.mjs migrations/2026-08-14_company_extra_contacts.sql
-- ---------------------------------------------------------------------

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME   = 'companies'
              AND COLUMN_NAME  = 'email_general_2');
SET @sql := IF(@c = 0,
  'ALTER TABLE companies ADD COLUMN email_general_2 VARCHAR(255) NULL AFTER email_general',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME   = 'companies'
              AND COLUMN_NAME  = 'email_general_3');
SET @sql := IF(@c = 0,
  'ALTER TABLE companies ADD COLUMN email_general_3 VARCHAR(255) NULL AFTER email_general_2',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME   = 'companies'
              AND COLUMN_NAME  = 'phone_main_2');
SET @sql := IF(@c = 0,
  'ALTER TABLE companies ADD COLUMN phone_main_2 VARCHAR(64) NULL AFTER phone_main',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME   = 'companies'
              AND COLUMN_NAME  = 'phone_main_3');
SET @sql := IF(@c = 0,
  'ALTER TABLE companies ADD COLUMN phone_main_3 VARCHAR(64) NULL AFTER phone_main_2',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
