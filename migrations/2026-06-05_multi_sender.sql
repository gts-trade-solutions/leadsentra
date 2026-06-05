-- Multi-sender support.
--
-- Before: one verified sender per user, stored as a bare email with no name.
-- After:  a user can verify multiple sender identities, each with its own
--         display name, and pick one as the default.  Campaigns record both
--         the chosen from_email AND from_name so the recipient sees
--         "Display Name" <email> in the From header.
--
-- Safe to run more than once: each ADD COLUMN is guarded so re-running on a
-- DB that already has the column is a no-op instead of an error.

-- ---- email_identities: display_name + is_default ---------------------------
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'email_identities'
     AND COLUMN_NAME = 'display_name'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE email_identities ADD COLUMN display_name VARCHAR(255) NULL AFTER email',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'email_identities'
     AND COLUMN_NAME = 'is_default'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE email_identities ADD COLUMN is_default TINYINT(1) NOT NULL DEFAULT 0 AFTER status',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---- campaigns: from_name ---------------------------------------------------
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'campaigns'
     AND COLUMN_NAME = 'from_name'
);
SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE campaigns ADD COLUMN from_name VARCHAR(255) NULL AFTER from_email',
  'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---- Backfill: make each user's most-recent identity their default ----------
-- Only acts when the user has no default yet, so re-running is harmless.
UPDATE email_identities ei
JOIN (
  SELECT user_id, MAX(updated_at) AS latest
    FROM email_identities
   GROUP BY user_id
) m ON m.user_id = ei.user_id AND m.latest = ei.updated_at
LEFT JOIN (
  SELECT user_id, COUNT(*) AS def_count
    FROM email_identities
   WHERE is_default = 1
   GROUP BY user_id
) d ON d.user_id = ei.user_id
SET ei.is_default = 1
WHERE COALESCE(d.def_count, 0) = 0;
