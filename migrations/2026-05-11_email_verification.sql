-- Migration: add email-verification flow.
--
-- - users.email_verified already exists in the canonical schema.sql, but if you
--   imported an older copy of schema.sql this ALTER is a safe no-op (IF NOT
--   EXISTS via dynamic SQL).
-- - One-time grandfather: mark every existing user as verified so accounts
--   created before this migration don't get locked out on next login.
-- - email_verification_tokens stores the bearer tokens emailed to users.

-- 1. Ensure email_verified column exists (idempotent)
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME   = 'users'
     AND COLUMN_NAME  = 'email_verified'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE users ADD COLUMN email_verified TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 2. Grandfather existing users
UPDATE users SET email_verified = 1 WHERE email_verified = 0;

-- 3. Token table
CREATE TABLE IF NOT EXISTS email_verification_tokens (
  token       CHAR(64)  NOT NULL,
  user_id     CHAR(36)  NOT NULL,
  expires_at  DATETIME  NOT NULL,
  created_at  DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (token),
  KEY idx_evt_user (user_id),
  KEY idx_evt_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
