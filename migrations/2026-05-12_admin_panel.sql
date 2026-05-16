-- Admin panel groundwork:
--   - campaigns.admin_bypass : true when sent by an admin/moderator with the
--     "skip unlocks + skip credit charge" override on.  Default 0.
--   - users.role index : faster lookups when listing users by role.

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME   = 'campaigns'
                AND COLUMN_NAME  = 'admin_bypass');
SET @sql := IF(@col = 0,
  'ALTER TABLE campaigns ADD COLUMN admin_bypass TINYINT(1) NOT NULL DEFAULT 0',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (SELECT COUNT(*) FROM information_schema.STATISTICS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME   = 'users'
                AND INDEX_NAME   = 'idx_users_role');
SET @sql := IF(@idx = 0,
  'ALTER TABLE users ADD KEY idx_users_role (role)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
