-- OTP-based email verification.
-- One active code per user; new sends REPLACE the previous row so old codes
-- are auto-invalidated.

CREATE TABLE IF NOT EXISTS email_otp_codes (
  user_id     CHAR(36)     NOT NULL,
  code_hash   VARCHAR(255) NOT NULL,            -- bcrypt of the 6-digit code
  expires_at  DATETIME     NOT NULL,
  attempts    INT          NOT NULL DEFAULT 0,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  KEY idx_eoc_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
