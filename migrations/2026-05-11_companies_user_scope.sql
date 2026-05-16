-- Migration: companies become user-scoped + add website/linkedin first-class columns.
--
-- Idempotent.  All ALTERs are guarded by information_schema lookups so re-running
-- the migration is safe.

SET @s := DATABASE();

-- 1. user_id
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA=@s AND TABLE_NAME='companies' AND COLUMN_NAME='user_id');
SET @sql := IF(@col=0,
  'ALTER TABLE companies ADD COLUMN user_id CHAR(36) NULL AFTER company_id',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA=@s AND TABLE_NAME='companies' AND INDEX_NAME='idx_companies_user');
SET @sql := IF(@idx=0,
  'ALTER TABLE companies ADD KEY idx_companies_user (user_id)',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. website
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA=@s AND TABLE_NAME='companies' AND COLUMN_NAME='website');
SET @sql := IF(@col=0,
  'ALTER TABLE companies ADD COLUMN website VARCHAR(512) NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. linkedin
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA=@s AND TABLE_NAME='companies' AND COLUMN_NAME='linkedin');
SET @sql := IF(@col=0,
  'ALTER TABLE companies ADD COLUMN linkedin VARCHAR(512) NULL',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
