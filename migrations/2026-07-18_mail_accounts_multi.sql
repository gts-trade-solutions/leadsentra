-- Allow MULTIPLE IMAP/Gmail accounts per user in the Inbox.
--
-- Before: `uniq_mail_user (user_id)` enforced one mailbox per user, and the
-- connect route upserted on it. This migration drops that unique key (keeping
-- a plain index for lookups), adds a friendly `label` and an `is_default` flag
-- so the UI can list/pick accounts, and marks each user's existing single
-- account as their default so nothing changes for current users.
--
-- Guarded + idempotent (safe to re-run).
--
-- Apply with:
--   node scripts/apply-sql2.mjs migrations/2026-07-18_mail_accounts_multi.sql <envfile>

-- 1. Drop the one-account-per-user unique key (if still present).
SET @has := (SELECT COUNT(*) FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME   = 'mail_accounts'
                AND INDEX_NAME   = 'uniq_mail_user');
SET @sql := IF(@has > 0, 'ALTER TABLE mail_accounts DROP INDEX uniq_mail_user', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. Plain index on user_id for listing a user's accounts.
SET @has := (SELECT COUNT(*) FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME   = 'mail_accounts'
                AND INDEX_NAME   = 'idx_mail_user');
SET @sql := IF(@has = 0, 'ALTER TABLE mail_accounts ADD KEY idx_mail_user (user_id)', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. Friendly label (e.g. "Sales inbox").
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME   = 'mail_accounts'
                AND COLUMN_NAME  = 'label');
SET @sql := IF(@col = 0, 'ALTER TABLE mail_accounts ADD COLUMN label VARCHAR(255) NULL AFTER from_name', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4. Default-account flag.
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME   = 'mail_accounts'
                AND COLUMN_NAME  = 'is_default');
SET @sql := IF(@col = 0, 'ALTER TABLE mail_accounts ADD COLUMN is_default TINYINT(1) NOT NULL DEFAULT 0 AFTER label', 'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 5. Mark each user's earliest existing account as their default (only when
--    they have no default yet — idempotent).
UPDATE mail_accounts m
JOIN (SELECT user_id, MIN(created_at) AS first_at FROM mail_accounts GROUP BY user_id) x
  ON x.user_id = m.user_id AND x.first_at = m.created_at
LEFT JOIN (SELECT user_id, COUNT(*) AS c FROM mail_accounts WHERE is_default = 1 GROUP BY user_id) d
  ON d.user_id = m.user_id
SET m.is_default = 1
WHERE COALESCE(d.c, 0) = 0;
