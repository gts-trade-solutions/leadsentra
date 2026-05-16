-- Final corrections to the schema so the remaining ports don't carry over
-- the grep-inferred (wrong) column names.

-- 1. company_assets_unlocks: should be keyed by company_id, not contact_id
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA=DATABASE()
                AND TABLE_NAME='company_assets_unlocks'
                AND COLUMN_NAME='company_id');
SET @sql := IF(@col=0,
  'ALTER TABLE company_assets_unlocks ADD COLUMN company_id CHAR(36) NULL AFTER user_id',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Backfill company_id from contact_id if anything sneaked in (best effort)
UPDATE company_assets_unlocks cau
  LEFT JOIN contacts c ON c.id = cau.contact_id
  SET cau.company_id = c.company_id
  WHERE cau.company_id IS NULL AND cau.contact_id IS NOT NULL;

-- 2. campaign_recipients: SES webhook wants bounced_at / complaint_at
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA=DATABASE()
                AND TABLE_NAME='campaign_recipients'
                AND COLUMN_NAME='bounced_at');
SET @sql := IF(@col=0,
  'ALTER TABLE campaign_recipients ADD COLUMN bounced_at DATETIME NULL AFTER last_event_at',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA=DATABASE()
                AND TABLE_NAME='campaign_recipients'
                AND COLUMN_NAME='complaint_at');
SET @sql := IF(@col=0,
  'ALTER TABLE campaign_recipients ADD COLUMN complaint_at DATETIME NULL AFTER bounced_at',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. contacts: add the columns the legacy company-detail route reads.
--    Previously stored in `meta` JSON; promote to first-class.
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='contacts' AND COLUMN_NAME='department');
SET @sql := IF(@col=0,
  'ALTER TABLE contacts ADD COLUMN department VARCHAR(128) NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='contacts' AND COLUMN_NAME='location');
SET @sql := IF(@col=0,
  'ALTER TABLE contacts ADD COLUMN location VARCHAR(255) NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='contacts' AND COLUMN_NAME='facebook_url');
SET @sql := IF(@col=0,
  'ALTER TABLE contacts ADD COLUMN facebook_url VARCHAR(512) NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='contacts' AND COLUMN_NAME='instagram_url');
SET @sql := IF(@col=0,
  'ALTER TABLE contacts ADD COLUMN instagram_url VARCHAR(512) NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='contacts' AND COLUMN_NAME='notes');
SET @sql := IF(@col=0,
  'ALTER TABLE contacts ADD COLUMN notes TEXT NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4. companies: add the rich profile fields used by the company-detail page.
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='companies' AND COLUMN_NAME='legal_name');
SET @sql := IF(@col=0,
  'ALTER TABLE companies ADD COLUMN legal_name VARCHAR(255) NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='companies' AND COLUMN_NAME='trading_name');
SET @sql := IF(@col=0,
  'ALTER TABLE companies ADD COLUMN trading_name VARCHAR(255) NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='companies' AND COLUMN_NAME='company_type');
SET @sql := IF(@col=0,
  'ALTER TABLE companies ADD COLUMN company_type VARCHAR(128) NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='companies' AND COLUMN_NAME='head_office_address');
SET @sql := IF(@col=0,
  'ALTER TABLE companies ADD COLUMN head_office_address TEXT NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='companies' AND COLUMN_NAME='city_regency');
SET @sql := IF(@col=0,
  'ALTER TABLE companies ADD COLUMN city_regency VARCHAR(128) NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='companies' AND COLUMN_NAME='postal_code');
SET @sql := IF(@col=0,
  'ALTER TABLE companies ADD COLUMN postal_code VARCHAR(32) NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='companies' AND COLUMN_NAME='phone_main');
SET @sql := IF(@col=0,
  'ALTER TABLE companies ADD COLUMN phone_main VARCHAR(64) NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='companies' AND COLUMN_NAME='email_general');
SET @sql := IF(@col=0,
  'ALTER TABLE companies ADD COLUMN email_general VARCHAR(255) NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='companies' AND COLUMN_NAME='notes');
SET @sql := IF(@col=0,
  'ALTER TABLE companies ADD COLUMN notes TEXT NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='companies' AND COLUMN_NAME='company_profile');
SET @sql := IF(@col=0,
  'ALTER TABLE companies ADD COLUMN company_profile TEXT NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='companies' AND COLUMN_NAME='financial_reports');
SET @sql := IF(@col=0,
  'ALTER TABLE companies ADD COLUMN financial_reports TEXT NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='companies' AND COLUMN_NAME='forecast_value');
SET @sql := IF(@col=0,
  'ALTER TABLE companies ADD COLUMN forecast_value DECIMAL(18,2) NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
