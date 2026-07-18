-- Facebook & Instagram URLs on companies, mirroring the existing website /
-- linkedin columns (contacts already have facebook_url / instagram_url). This
-- lets the Add/Edit Company form, the XLSX import + template, and the company
-- detail view carry a company's own social links.
--
-- Guarded + idempotent (safe to re-run).
--
-- Apply with:
--   node scripts/apply-sql2.mjs migrations/2026-07-18_company_socials.sql <envfile>

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME   = 'companies'
                AND COLUMN_NAME  = 'facebook_url');
SET @sql := IF(@col = 0,
  'ALTER TABLE companies ADD COLUMN facebook_url VARCHAR(512) NULL AFTER linkedin',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME   = 'companies'
                AND COLUMN_NAME  = 'instagram_url');
SET @sql := IF(@col = 0,
  'ALTER TABLE companies ADD COLUMN instagram_url VARCHAR(512) NULL AFTER facebook_url',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
