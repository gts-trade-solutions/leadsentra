-- Per-recipient failure reason on campaign_recipients.
--
-- Without this, the tracking page can show "failed" status but not WHY,
-- which makes debugging real-world send failures (auth errors, throttling,
-- recipient rejected, etc.) impossible from the UI.
--
-- Truncated to 500 chars — SES error messages are typically <250.

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME   = 'campaign_recipients'
                AND COLUMN_NAME  = 'error_reason');
SET @sql := IF(@col = 0,
  'ALTER TABLE campaign_recipients ADD COLUMN error_reason VARCHAR(500) NULL AFTER status',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
