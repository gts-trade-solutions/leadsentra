-- Suppression list: per-user emails + domains that must never receive campaigns.
-- Unique on (user_id, type, value) so a duplicate POST is a no-op error.

CREATE TABLE IF NOT EXISTS suppressions (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  user_id     CHAR(36)     NOT NULL,
  type        VARCHAR(8)   NOT NULL,   -- 'email' | 'domain'
  value       VARCHAR(255) NOT NULL,   -- stored lower-cased
  reason      VARCHAR(255) NULL,
  source      VARCHAR(32)  NOT NULL DEFAULT 'manual',  -- manual / bounce / complaint / unsubscribe / import
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_supp_user_type_value (user_id, type, value),
  KEY idx_supp_user (user_id, created_at),
  KEY idx_supp_type (type),
  KEY idx_supp_value (value)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
