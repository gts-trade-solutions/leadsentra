-- Mailbox connections for the in-app Inbox (read & reply to campaign replies).
-- One IMAP account per user. The password is stored encrypted (AES-256-GCM,
-- see lib/secretBox.ts) — never in plaintext.
--
-- Apply with:  node scripts/apply-sql.mjs migrations/2026-06-23_mail_accounts.sql

CREATE TABLE IF NOT EXISTS mail_accounts (
  id              CHAR(36)      NOT NULL,
  user_id         CHAR(36)      NOT NULL,
  imap_host       VARCHAR(255)  NOT NULL,
  imap_port       INT           NOT NULL DEFAULT 993,
  imap_secure     TINYINT(1)    NOT NULL DEFAULT 1,   -- 1 = implicit TLS (port 993)
  username        VARCHAR(255)  NOT NULL,             -- mailbox login (usually the email)
  password_enc    TEXT          NOT NULL,             -- encrypted IMAP password
  from_name       VARCHAR(255)  NULL,                 -- display name used when replying
  last_checked_at DATETIME      NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_mail_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
