-- "Corrected" flag on suppression rows.  When an admin reviews a bounced
-- entry and confirms the address is actually valid (e.g. the recipient
-- fixed their mailbox), they can mark it as corrected.  Corrected rows are
-- kept in the table for audit/history but `isSuppressed()` ignores them,
-- so future campaigns can deliver to that address again.

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME   = 'suppressions'
                AND COLUMN_NAME  = 'corrected');
SET @sql := IF(@col = 0,
  'ALTER TABLE suppressions ADD COLUMN corrected TINYINT(1) NOT NULL DEFAULT 0 AFTER source, ADD KEY idx_suppressions_corrected (corrected)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Track when/who marked the row as corrected, so the suppressions page can
-- show "Corrected on 2026-05-15 by ..." in a tooltip later.
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME   = 'suppressions'
                AND COLUMN_NAME  = 'corrected_at');
SET @sql := IF(@col = 0,
  'ALTER TABLE suppressions ADD COLUMN corrected_at DATETIME NULL AFTER corrected',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
