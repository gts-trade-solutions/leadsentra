-- Password-reset tokens, same shape as email_verification_tokens.
CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token       CHAR(64)  NOT NULL,
  user_id     CHAR(36)  NOT NULL,
  expires_at  DATETIME  NOT NULL,
  used_at     DATETIME  NULL,
  created_at  DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (token),
  KEY idx_prt_user (user_id),
  KEY idx_prt_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
