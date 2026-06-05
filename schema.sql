-- =====================================================================
-- MySQL 8.0+ schema for LeadIQ (migrated from Supabase / PostgreSQL)
--
-- NOTE: column lists were inferred from grep of the codebase.  Until you
-- diff this against your real PG dump, treat any column not exercised by
-- application code as best-guess and adjust types/lengths if needed.
--
-- Conventions:
--   uuid (Postgres)        -> CHAR(36)  (app generates UUIDs; insert via UUID())
--   timestamptz            -> DATETIME  (store UTC; app uses new Date().toISOString())
--   jsonb / json           -> JSON
--   boolean                -> TINYINT(1)
--   text                   -> TEXT (or VARCHAR where length is bounded)
--   numeric                -> DECIMAL(18,4)
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------
-- 1. AUTH (replaces supabase.auth.users + public.profiles)
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS users;
CREATE TABLE users (
  id              CHAR(36)      NOT NULL,
  email           VARCHAR(255)  NOT NULL,
  password_hash   VARCHAR(255)  NOT NULL,
  full_name       VARCHAR(255)  NULL,
  role            VARCHAR(32)   NOT NULL DEFAULT 'user',
  email_verified  TINYINT(1)    NOT NULL DEFAULT 0,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- A `profiles` view kept for compatibility with code that selects from "profiles".
-- New code should query `users` directly.
DROP VIEW IF EXISTS profiles;
CREATE VIEW profiles AS
  SELECT id, id AS user_id, email, full_name, role, created_at, updated_at
  FROM users;

-- Email verification tokens issued by /api/auth/register and consumed by
-- /api/auth/verify.  Tokens are 64 hex chars (32 bytes of randomness).
DROP TABLE IF EXISTS email_verification_tokens;
CREATE TABLE email_verification_tokens (
  token       CHAR(64)  NOT NULL,
  user_id     CHAR(36)  NOT NULL,
  expires_at  DATETIME  NOT NULL,
  created_at  DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (token),
  KEY idx_evt_user (user_id),
  KEY idx_evt_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Password-reset tokens issued by /api/auth/forgot and consumed by /api/auth/reset.
DROP TABLE IF EXISTS password_reset_tokens;
CREATE TABLE password_reset_tokens (
  token       CHAR(64)  NOT NULL,
  user_id     CHAR(36)  NOT NULL,
  expires_at  DATETIME  NOT NULL,
  used_at     DATETIME  NULL,
  created_at  DATETIME  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (token),
  KEY idx_prt_user (user_id),
  KEY idx_prt_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One active OTP per user (used by future flows like email-change verification).
DROP TABLE IF EXISTS email_otp_codes;
CREATE TABLE email_otp_codes (
  user_id     CHAR(36)     NOT NULL,
  code_hash   VARCHAR(255) NOT NULL,
  expires_at  DATETIME     NOT NULL,
  attempts    INT          NOT NULL DEFAULT 0,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  KEY idx_eoc_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Per-user suppression list (emails + domains) for campaign sends.
DROP TABLE IF EXISTS suppressions;
CREATE TABLE suppressions (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  user_id     CHAR(36)     NOT NULL,
  type        VARCHAR(8)   NOT NULL,
  value       VARCHAR(255) NOT NULL,
  reason      VARCHAR(255) NULL,
  source      VARCHAR(32)  NOT NULL DEFAULT 'manual',
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_supp_user_type_value (user_id, type, value),
  KEY idx_supp_user (user_id, created_at),
  KEY idx_supp_type (type),
  KEY idx_supp_value (value)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Signup OTP gate: the `users` row is only inserted after this is verified.
-- Holds the bcrypted password + bcrypted OTP code; one row per email.
DROP TABLE IF EXISTS pending_registrations;
CREATE TABLE pending_registrations (
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

-- ---------------------------------------------------------------------
-- 2. ANALYTICS
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS analytics_events;
CREATE TABLE analytics_events (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  user_id     CHAR(36)     NULL,
  event_type  VARCHAR(64)  NOT NULL,
  provider    VARCHAR(64)  NULL,
  meta        JSON         NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ae_user_created (user_id, created_at),
  KEY idx_ae_event_provider (event_type, provider)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- 3. BILLING
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS billing_profiles;
CREATE TABLE billing_profiles (
  user_id    CHAR(36)      NOT NULL,
  full_name  VARCHAR(255)  NULL,
  email      VARCHAR(255)  NULL,
  phone      VARCHAR(64)   NULL,
  company    VARCHAR(255)  NULL,
  gstin      VARCHAR(32)   NULL,
  address    TEXT          NULL,
  created_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

DROP TABLE IF EXISTS payments;
CREATE TABLE payments (
  id                  CHAR(36)     NOT NULL,
  user_id             CHAR(36)     NOT NULL,
  razorpay_order_id   VARCHAR(64)  NULL,
  razorpay_payment_id VARCHAR(64)  NULL,
  status              VARCHAR(32)  NOT NULL DEFAULT 'created',
  credits             INT          NOT NULL DEFAULT 0,
  amount_inr_paise    BIGINT       NULL,
  meta                JSON         NULL,
  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payments_order (razorpay_order_id),
  KEY idx_payments_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- 4. CREDITS / WALLET
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS credits_wallets;
CREATE TABLE credits_wallets (
  user_id   CHAR(36)    NOT NULL,
  balance   INT         NOT NULL DEFAULT 0,
  plan      VARCHAR(32) NOT NULL DEFAULT 'free',
  resets_at DATETIME    NULL,
  updated_at DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

DROP TABLE IF EXISTS credits_ledger;
CREATE TABLE credits_ledger (
  id             BIGINT       NOT NULL AUTO_INCREMENT,
  user_id        CHAR(36)     NOT NULL,
  delta          INT          NOT NULL,             -- positive credit, negative debit
  kind           VARCHAR(32)  NOT NULL,             -- debit / credit / refund / topup
  correlation_id VARCHAR(128) NULL,
  note           VARCHAR(255) NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_cl_user_created (user_id, created_at),
  KEY idx_cl_correlation (correlation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

DROP TABLE IF EXISTS credits_prices;
CREATE TABLE credits_prices (
  feature VARCHAR(64) NOT NULL,
  price   INT         NOT NULL,
  PRIMARY KEY (feature)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Legacy "wallet" table referenced by lib/wallet.ts -- mirror of credits_wallets balance
DROP TABLE IF EXISTS wallet;
CREATE TABLE wallet (
  user_id CHAR(36) NOT NULL,
  balance INT      NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- 5. COMPANIES / CONTACTS
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS companies;
CREATE TABLE companies (
  company_id   CHAR(36)      NOT NULL,
  user_id      CHAR(36)      NULL,                -- owner / uploader (null = legacy/global)
  company_name VARCHAR(255)  NOT NULL,
  domain       VARCHAR(255)  NULL,
  industry     VARCHAR(128)  NULL,
  size         VARCHAR(64)   NULL,
  country      VARCHAR(64)   NULL,
  website      VARCHAR(512)  NULL,
  linkedin     VARCHAR(512)  NULL,
  meta         JSON          NULL,
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (company_id),
  KEY idx_companies_user (user_id),
  KEY idx_companies_name (company_name),
  KEY idx_companies_domain (domain)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

DROP TABLE IF EXISTS contacts;
CREATE TABLE contacts (
  id           CHAR(36)      NOT NULL,
  user_id      CHAR(36)      NULL,                 -- owner / uploader
  company_id   CHAR(36)      NULL,
  contact_name VARCHAR(255)  NULL,
  email        VARCHAR(255)  NULL,
  title        VARCHAR(255)  NULL,
  phone        VARCHAR(64)   NULL,
  linkedin_url VARCHAR(512)  NULL,
  meta         JSON          NULL,
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_contacts_company (company_id),
  KEY idx_contacts_email (email),
  KEY idx_contacts_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

DROP TABLE IF EXISTS contacts_unlocks;
CREATE TABLE contacts_unlocks (
  user_id    CHAR(36) NOT NULL,
  contact_id CHAR(36) NOT NULL,
  unlocked_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, contact_id),
  KEY idx_cu_contact (contact_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

DROP TABLE IF EXISTS unlocked_contacts;
CREATE TABLE unlocked_contacts (
  user_id    CHAR(36) NOT NULL,
  contact_id CHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, contact_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

DROP TABLE IF EXISTS company_assets_unlocks;
CREATE TABLE company_assets_unlocks (
  user_id    CHAR(36)     NOT NULL,
  contact_id CHAR(36)     NOT NULL,    -- existing column observed; semantically a company unlock keyed by contact
  asset      VARCHAR(64)  NOT NULL,    -- e.g. 'mgmt_pack', 'phone', 'email'
  unlocked_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, contact_id, asset)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- View used by api/companies and api/mapping/summary
DROP VIEW IF EXISTS company_contact_counts;
CREATE VIEW company_contact_counts AS
  SELECT c.company_id, COUNT(ct.id) AS contact_count
  FROM companies c
  LEFT JOIN contacts ct ON ct.company_id = c.company_id
  GROUP BY c.company_id;

-- View used by campaign UI
DROP VIEW IF EXISTS unlocked_contacts_v;
CREATE VIEW unlocked_contacts_v AS
  SELECT uc.user_id, uc.contact_id, c.contact_name, c.email, c.company_id, c.title
  FROM unlocked_contacts uc
  JOIN contacts c ON c.id = uc.contact_id;

-- View of contacts whose company_id has no row in companies (mapping mismatch)
DROP VIEW IF EXISTS unmapped_contacts;
CREATE VIEW unmapped_contacts AS
  SELECT ct.*
  FROM contacts ct
  LEFT JOIN companies co ON co.company_id = ct.company_id
  WHERE ct.company_id IS NOT NULL AND co.company_id IS NULL;

-- ---------------------------------------------------------------------
-- 6. CAMPAIGNS
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS campaigns;
CREATE TABLE campaigns (
  id                CHAR(36)     NOT NULL,
  user_id           CHAR(36)     NOT NULL,
  name              VARCHAR(255) NOT NULL,
  subject           VARCHAR(255) NULL,
  html              MEDIUMTEXT   NULL,
  from_email        VARCHAR(255) NULL,
  from_name         VARCHAR(255) NULL,
  price_per_email   DECIMAL(10,4) NOT NULL DEFAULT 0,
  recipients_count  INT          NOT NULL DEFAULT 0,
  credits_charged   INT          NOT NULL DEFAULT 0,
  status            VARCHAR(32)  NOT NULL DEFAULT 'draft',
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_campaigns_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

DROP TABLE IF EXISTS campaign_recipients;
CREATE TABLE campaign_recipients (
  id              CHAR(36)     NOT NULL,
  campaign_id     CHAR(36)     NOT NULL,
  user_id         CHAR(36)     NULL,
  contact_id      CHAR(36)     NULL,
  email           VARCHAR(255) NOT NULL,
  tracking_token  VARCHAR(64)  NULL,
  message_id      VARCHAR(255) NULL,
  status          VARCHAR(32)  NOT NULL DEFAULT 'queued',
  opens_count     INT          NOT NULL DEFAULT 0,
  clicks_count    INT          NOT NULL DEFAULT 0,
  opened_at       DATETIME     NULL,
  clicked_at      DATETIME     NULL,
  last_event_at   DATETIME     NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_cr_campaign (campaign_id),
  KEY idx_cr_token (tracking_token),
  KEY idx_cr_message (message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

DROP TABLE IF EXISTS campaign_events;
CREATE TABLE campaign_events (
  id           BIGINT       NOT NULL AUTO_INCREMENT,
  campaign_id  CHAR(36)     NOT NULL,
  recipient_id CHAR(36)     NULL,
  kind         VARCHAR(32)  NOT NULL,    -- sent, open, click, delivery, bounce, complaint
  meta         JSON         NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ce_campaign (campaign_id, created_at),
  KEY idx_ce_recipient (recipient_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One-off (non-campaign) emails tracked similarly
DROP TABLE IF EXISTS oneoff_emails;
CREATE TABLE oneoff_emails (
  id            CHAR(36)     NOT NULL,
  user_id       CHAR(36)     NULL,
  message_id    VARCHAR(255) NULL,
  status        VARCHAR(32)  NOT NULL DEFAULT 'queued',
  opens_count   INT          NOT NULL DEFAULT 0,
  clicks_count  INT          NOT NULL DEFAULT 0,
  opened_at     DATETIME     NULL,
  clicked_at    DATETIME     NULL,
  last_event_at DATETIME     NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_oe_message (message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- 7. EMAIL SENDER (SES / Resend identities)
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS email_identities;
CREATE TABLE email_identities (
  id             CHAR(36)     NOT NULL,
  user_id        CHAR(36)     NOT NULL,
  email          VARCHAR(255) NOT NULL,
  display_name   VARCHAR(255) NULL,                        -- friendly From name, e.g. "Race Auto India"
  status         VARCHAR(32)  NOT NULL DEFAULT 'pending',  -- pending / verified / failed
  is_default     TINYINT(1)   NOT NULL DEFAULT 0,          -- one default sender per user
  verified_at    DATETIME     NULL,
  changes_used   INT          NOT NULL DEFAULT 0,
  changes_limit  INT          NOT NULL DEFAULT 3,
  provider       VARCHAR(32)  NOT NULL DEFAULT 'ses',
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ei_user_email (user_id, email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

DROP TABLE IF EXISTS email_sends;
CREATE TABLE email_sends (
  id         BIGINT     NOT NULL AUTO_INCREMENT,
  user_id    CHAR(36)   NOT NULL,
  message_id VARCHAR(255) NULL,
  to_email   VARCHAR(255) NULL,
  subject    VARCHAR(255) NULL,
  created_at DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_es_user_created (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- 8. SOCIAL (Facebook / LinkedIn)
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS social_accounts;
CREATE TABLE social_accounts (
  id                  CHAR(36)     NOT NULL,
  user_id             CHAR(36)     NOT NULL,
  provider            VARCHAR(32)  NOT NULL,    -- facebook / linkedin
  access_token        TEXT         NULL,
  refresh_token       TEXT         NULL,
  scope               TEXT         NULL,
  expires_at          DATETIME     NULL,

  fb_user_id          VARCHAR(64)  NULL,
  page_ids            JSON         NULL,
  page_name           VARCHAR(255) NULL,
  page_access_token   TEXT         NULL,
  selected_page_id    VARCHAR(64)  NULL,
  selected_page_name  VARCHAR(255) NULL,

  member_urn          VARCHAR(255) NULL,
  org_urns            JSON         NULL,

  created_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sa_user_provider (user_id, provider)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

DROP TABLE IF EXISTS social_oauth_states;
CREATE TABLE social_oauth_states (
  state      VARCHAR(128) NOT NULL,
  user_id    CHAR(36)     NOT NULL,
  provider   VARCHAR(32)  NOT NULL,
  meta       JSON         NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (state),
  KEY idx_sos_user (user_id, provider)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

DROP TABLE IF EXISTS social_account_limits;
CREATE TABLE social_account_limits (
  user_id       CHAR(36)    NOT NULL,
  provider      VARCHAR(32) NOT NULL,
  changes_used  INT         NOT NULL DEFAULT 0,
  changes_limit INT         NOT NULL DEFAULT 3,
  updated_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, provider)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

DROP TABLE IF EXISTS social_connection_usage;
CREATE TABLE social_connection_usage (
  user_id      CHAR(36)    NOT NULL,
  provider     VARCHAR(32) NOT NULL,
  changes_used INT         NOT NULL DEFAULT 0,
  updated_at   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, provider)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

DROP TABLE IF EXISTS facebook_posts;
CREATE TABLE facebook_posts (
  id          CHAR(36)     NOT NULL,
  user_id     CHAR(36)     NOT NULL,
  page_id     VARCHAR(64)  NULL,
  fb_post_id  VARCHAR(128) NULL,
  message     TEXT         NULL,
  media_urls  JSON         NULL,
  status      VARCHAR(32)  NOT NULL DEFAULT 'posted',
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_fp_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

DROP TABLE IF EXISTS linkedin_posts;
CREATE TABLE linkedin_posts (
  id            CHAR(36)     NOT NULL,
  user_id       CHAR(36)     NOT NULL,
  member_urn    VARCHAR(255) NULL,
  li_post_urn   VARCHAR(255) NULL,
  body          TEXT         NULL,
  media_urls    JSON         NULL,
  status        VARCHAR(32)  NOT NULL DEFAULT 'posted',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_lp_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- 9. CONTENT DRAFTS (Facebook scheduler)
-- ---------------------------------------------------------------------
DROP TABLE IF EXISTS content_drafts;
CREATE TABLE content_drafts (
  id           CHAR(36)     NOT NULL,
  user_id      CHAR(36)     NOT NULL,
  title        VARCHAR(255) NULL,
  body         TEXT         NULL,
  media_urls   JSON         NULL,
  share_url    VARCHAR(512) NULL,
  status       VARCHAR(32)  NOT NULL DEFAULT 'draft',
  scheduled_at DATETIME     NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_cd_user_status (user_id, status, scheduled_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;

-- =====================================================================
-- STORED PROCEDURES (replacements for the 10 PostgreSQL RPCs)
--
-- These are best-guess implementations based on call signatures observed
-- in the codebase.  REVIEW AND ADJUST against your real PG function
-- bodies once you have them.
-- =====================================================================

DELIMITER $$

-- spend_credit(user_id, amount, kind, correlation_id, note)
DROP PROCEDURE IF EXISTS spend_credit$$
CREATE PROCEDURE spend_credit(
  IN p_user_id CHAR(36),
  IN p_amount  INT,
  IN p_kind    VARCHAR(32),
  IN p_correlation_id VARCHAR(128),
  IN p_note    VARCHAR(255)
)
BEGIN
  DECLARE v_balance INT;
  START TRANSACTION;
    SELECT balance INTO v_balance FROM credits_wallets
      WHERE user_id = p_user_id FOR UPDATE;
    IF v_balance IS NULL THEN
      INSERT INTO credits_wallets (user_id, balance) VALUES (p_user_id, 0);
      SET v_balance = 0;
    END IF;
    IF v_balance < p_amount THEN
      ROLLBACK;
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'insufficient_credits';
    END IF;
    UPDATE credits_wallets
       SET balance = balance - p_amount, updated_at = NOW()
     WHERE user_id = p_user_id;
    INSERT INTO credits_ledger (user_id, delta, kind, correlation_id, note)
      VALUES (p_user_id, -p_amount, p_kind, p_correlation_id, p_note);
  COMMIT;
  SELECT (v_balance - p_amount) AS new_balance;
END$$

-- attempt_spend(user_id, amount, kind, correlation_id, note) -> success boolean + new_balance
DROP PROCEDURE IF EXISTS attempt_spend$$
CREATE PROCEDURE attempt_spend(
  IN p_user_id CHAR(36),
  IN p_amount  INT,
  IN p_kind    VARCHAR(32),
  IN p_correlation_id VARCHAR(128),
  IN p_note    VARCHAR(255)
)
BEGIN
  DECLARE v_balance INT;
  START TRANSACTION;
    SELECT balance INTO v_balance FROM credits_wallets
      WHERE user_id = p_user_id FOR UPDATE;
    IF v_balance IS NULL THEN
      INSERT INTO credits_wallets (user_id, balance) VALUES (p_user_id, 0);
      SET v_balance = 0;
    END IF;
    IF v_balance < p_amount THEN
      COMMIT;
      SELECT 0 AS ok, v_balance AS balance;
    ELSE
      UPDATE credits_wallets
         SET balance = balance - p_amount, updated_at = NOW()
       WHERE user_id = p_user_id;
      INSERT INTO credits_ledger (user_id, delta, kind, correlation_id, note)
        VALUES (p_user_id, -p_amount, p_kind, p_correlation_id, p_note);
      COMMIT;
      SELECT 1 AS ok, (v_balance - p_amount) AS balance;
    END IF;
END$$

-- fn_available_credits(user_id) -> single int
DROP PROCEDURE IF EXISTS fn_available_credits$$
CREATE PROCEDURE fn_available_credits(IN p_user_id CHAR(36))
BEGIN
  SELECT COALESCE((SELECT balance FROM credits_wallets WHERE user_id = p_user_id), 0) AS balance;
END$$

-- contacts_list(user_id, search, page, page_size) -> contact rows + unlocked flag
DROP PROCEDURE IF EXISTS contacts_list$$
CREATE PROCEDURE contacts_list(
  IN p_user_id   CHAR(36),
  IN p_search    VARCHAR(255),
  IN p_limit     INT,
  IN p_offset    INT
)
BEGIN
  SELECT
    c.id, c.contact_name, c.title, c.email, c.phone, c.linkedin_url,
    c.company_id, co.company_name,
    (uc.contact_id IS NOT NULL) AS unlocked
  FROM contacts c
  LEFT JOIN companies co ON co.company_id = c.company_id
  LEFT JOIN unlocked_contacts uc
    ON uc.contact_id = c.id AND uc.user_id = p_user_id
  WHERE p_search IS NULL OR p_search = ''
     OR c.contact_name LIKE CONCAT('%', p_search, '%')
     OR c.email        LIKE CONCAT('%', p_search, '%')
     OR co.company_name LIKE CONCAT('%', p_search, '%')
  ORDER BY c.created_at DESC
  LIMIT p_limit OFFSET p_offset;
END$$

-- unlock_contact(user_id, contact_id) -> charges credits + records unlock
DROP PROCEDURE IF EXISTS unlock_contact$$
CREATE PROCEDURE unlock_contact(
  IN p_user_id    CHAR(36),
  IN p_contact_id CHAR(36)
)
BEGIN
  DECLARE v_price   INT DEFAULT 1;
  DECLARE v_already INT DEFAULT 0;
  SELECT COUNT(*) INTO v_already
    FROM unlocked_contacts WHERE user_id = p_user_id AND contact_id = p_contact_id;
  IF v_already > 0 THEN
    SELECT 1 AS ok, 'already_unlocked' AS status;
  ELSE
    SELECT COALESCE((SELECT price FROM credits_prices WHERE feature='contact_unlock'), 1)
      INTO v_price;
    CALL spend_credit(p_user_id, v_price, 'debit',
      CONCAT('unlock:', p_contact_id), 'unlock_contact');
    INSERT IGNORE INTO unlocked_contacts (user_id, contact_id) VALUES (p_user_id, p_contact_id);
    INSERT IGNORE INTO contacts_unlocks (user_id, contact_id) VALUES (p_user_id, p_contact_id);
    SELECT 1 AS ok, 'unlocked' AS status;
  END IF;
END$$

-- unlock_contacts_bulk(user_id, contact_ids JSON array) -> count unlocked
DROP PROCEDURE IF EXISTS unlock_contacts_bulk$$
CREATE PROCEDURE unlock_contacts_bulk(
  IN p_user_id     CHAR(36),
  IN p_contact_ids JSON
)
BEGIN
  DECLARE v_i INT DEFAULT 0;
  DECLARE v_n INT;
  DECLARE v_id CHAR(36);
  SET v_n = JSON_LENGTH(p_contact_ids);
  WHILE v_i < v_n DO
    SET v_id = JSON_UNQUOTE(JSON_EXTRACT(p_contact_ids, CONCAT('$[', v_i, ']')));
    CALL unlock_contact(p_user_id, v_id);
    SET v_i = v_i + 1;
  END WHILE;
  SELECT v_n AS unlocked;
END$$

-- cr_mark_open(token) -> bumps open counters on the matching campaign_recipient
DROP PROCEDURE IF EXISTS cr_mark_open$$
CREATE PROCEDURE cr_mark_open(IN p_token VARCHAR(64))
BEGIN
  UPDATE campaign_recipients
     SET opens_count = opens_count + 1,
         opened_at   = COALESCE(opened_at, NOW()),
         last_event_at = NOW()
   WHERE tracking_token = p_token;

  INSERT INTO campaign_events (campaign_id, recipient_id, kind)
    SELECT campaign_id, id, 'open'
      FROM campaign_recipients WHERE tracking_token = p_token;
END$$

-- cr_mark_click(token, url) -> bumps click counters
DROP PROCEDURE IF EXISTS cr_mark_click$$
CREATE PROCEDURE cr_mark_click(IN p_token VARCHAR(64), IN p_url VARCHAR(1024))
BEGIN
  UPDATE campaign_recipients
     SET clicks_count = clicks_count + 1,
         clicked_at   = COALESCE(clicked_at, NOW()),
         last_event_at = NOW()
   WHERE tracking_token = p_token;

  INSERT INTO campaign_events (campaign_id, recipient_id, kind, meta)
    SELECT campaign_id, id, 'click', JSON_OBJECT('url', p_url)
      FROM campaign_recipients WHERE tracking_token = p_token;
END$$

-- unlock_company_asset(user_id, contact_id, asset)
DROP PROCEDURE IF EXISTS unlock_company_asset$$
CREATE PROCEDURE unlock_company_asset(
  IN p_user_id CHAR(36),
  IN p_contact_id CHAR(36),
  IN p_asset VARCHAR(64)
)
BEGIN
  DECLARE v_price INT DEFAULT 1;
  DECLARE v_already INT DEFAULT 0;
  SELECT COUNT(*) INTO v_already
    FROM company_assets_unlocks
    WHERE user_id = p_user_id AND contact_id = p_contact_id AND asset = p_asset;
  IF v_already > 0 THEN
    SELECT 1 AS ok, 'already_unlocked' AS status;
  ELSE
    SELECT COALESCE((SELECT price FROM credits_prices WHERE feature = CONCAT('asset_', p_asset)), 1)
      INTO v_price;
    CALL spend_credit(p_user_id, v_price, 'debit',
      CONCAT('asset:', p_contact_id, ':', p_asset), 'unlock_company_asset');
    INSERT INTO company_assets_unlocks (user_id, contact_id, asset)
      VALUES (p_user_id, p_contact_id, p_asset);
    SELECT 1 AS ok, 'unlocked' AS status;
  END IF;
END$$

-- unlock_company_mgmt_pack(user_id, contact_id) -- shorthand for the 'mgmt_pack' asset
DROP PROCEDURE IF EXISTS unlock_company_mgmt_pack$$
CREATE PROCEDURE unlock_company_mgmt_pack(
  IN p_user_id    CHAR(36),
  IN p_contact_id CHAR(36)
)
BEGIN
  CALL unlock_company_asset(p_user_id, p_contact_id, 'mgmt_pack');
END$$

DELIMITER ;

-- =====================================================================
-- Seed: default credit prices (adjust to your real prices)
-- =====================================================================
-- Credit pricing v2 (2026-05-12): bulk-email rebalance + Apollo-tier unlocks.
-- See migrations/2026-05-12_credit_pricing_v2.sql for the rationale.
INSERT INTO credits_prices (feature, price) VALUES
  ('contact_unlock',      2),  -- Apollo-tier reveal
  ('asset_phone',         1),
  ('asset_email',         1),
  ('asset_financials',   10),  -- financial report unlock
  ('asset_forecast',     10),  -- forecast unlock
  ('asset_mgmt_pack',    25),  -- bundle of financials + forecast + contact unlocks
  ('email_send_batch',    1),  -- 1 credit per 50 recipients per send job
  ('email_send',          1),  -- retired but kept for back-compat
  ('ai_draft',            2),  -- text optimize
  ('ai_image',            5),  -- AI image generation
  ('facebook_post',       1),
  ('linkedin_post',       1)
ON DUPLICATE KEY UPDATE price = VALUES(price);
