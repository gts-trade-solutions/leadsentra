-- Per-campaign "reduce promotional signals" flag. When set, the send pipeline
-- omits the open-tracking pixel, the click-tracking link rewrites, and the
-- Precedence: bulk / Auto-Submitted headers (List-Unsubscribe is kept for
-- compliance) — aiming for Gmail's Primary tab instead of Promotions, at the
-- cost of open/click analytics for that campaign.
--
-- Guarded + idempotent (safe to re-run).
--
-- Apply with:
--   node scripts/apply-sql2.mjs migrations/2026-07-18_campaign_low_signal.sql <envfile>

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME   = 'campaigns'
                AND COLUMN_NAME  = 'low_signal');
SET @sql := IF(@col = 0,
  'ALTER TABLE campaigns ADD COLUMN low_signal TINYINT(1) NOT NULL DEFAULT 0 AFTER admin_bypass',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
