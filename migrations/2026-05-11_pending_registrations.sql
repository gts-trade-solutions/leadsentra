-- Holds in-flight signups: the user row is NOT created until the OTP is
-- verified.  REPLACE on resend, DELETE on success, DELETE on expiry.

CREATE TABLE IF NOT EXISTS pending_registrations (
  email          VARCHAR(255)  NOT NULL,
  password_hash  VARCHAR(255)  NOT NULL,
  full_name      VARCHAR(255)  NULL,
  code_hash      VARCHAR(255)  NOT NULL,
  expires_at     DATETIME      NOT NULL,
  attempts       INT           NOT NULL DEFAULT 0,
  created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (email),
  KEY idx_pr_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
