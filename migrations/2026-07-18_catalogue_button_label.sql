-- Editable "Download" button text for catalogues/offers. When set, the send
-- email uses this as the button's label instead of the default
-- "Download catalogue: <filename>".
--
-- Guarded + idempotent (safe to re-run).
--
-- Apply with:
--   node scripts/apply-sql2.mjs migrations/2026-07-18_catalogue_button_label.sql <envfile>

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME   = 'company_catalogues'
                AND COLUMN_NAME  = 'button_label');
SET @sql := IF(@col = 0,
  'ALTER TABLE company_catalogues ADD COLUMN button_label VARCHAR(255) NULL AFTER body',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
