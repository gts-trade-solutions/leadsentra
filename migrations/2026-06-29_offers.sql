-- ---------------------------------------------------------------------
-- LBI Route-Survey Offers (RACE "INTELLECT" Location Based Intelligence)
--
-- A seller (the signed-in user) issues a multi-page offer / quotation to a
-- customer. The fixed template text (scope of work, methodology, banking,
-- terms & conditions) lives in lib/offerPdf.ts; only the DYNAMIC fields are
-- stored here — recipient, route list, proposed cargo dimensions, timeline,
-- quote number and the combined cost.
--
-- Seller identity (company, address, email, bank, logo) is reused from
-- invoice_settings, so a user configures those once for both invoices & offers.
-- Money columns are DECIMAL to avoid float rounding on totals.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS offers (
  id                 CHAR(36)      NOT NULL,
  user_id            CHAR(36)      NOT NULL,            -- seller / owner
  offer_number       VARCHAR(96)   NOT NULL,           -- Quote No, e.g. RIPL/LBI/VK/024/26-27
  status             VARCHAR(16)   NOT NULL DEFAULT 'draft',  -- draft | sent
  source             VARCHAR(16)   NOT NULL DEFAULT 'generated',

  -- Recipient (the "To" / "Kind Attention" block on the letter & commercial).
  customer_contact_id CHAR(36)     NULL,
  customer_company_id CHAR(36)     NULL,
  customer_company   VARCHAR(255)  NULL,               -- M/s Kuehne + Nagel Pvt. Ltd.
  customer_name      VARCHAR(255)  NULL,               -- attention person, e.g. Mr. Somnath Ganguly
  customer_email     VARCHAR(255)  NULL,
  customer_address   TEXT          NULL,
  salutation         VARCHAR(64)   NULL,               -- Dear Sir

  -- Subject / reference paragraph route description (free text).
  subject            TEXT          NULL,

  -- Proposed maximum-dimension cargo movement.
  cargo_length       VARCHAR(64)   NULL,               -- e.g. 55m
  cargo_weight       VARCHAR(64)   NULL,               -- e.g. 150 MT
  cargo_diameter     VARCHAR(64)   NULL,               -- e.g. 5m

  -- Commercial terms.
  survey_timeline    VARCHAR(255)  NULL,               -- 4-6 weeks for the completion of survey and reporting
  delivery           VARCHAR(255)  NULL,               -- 4-6 weeks
  currency           VARCHAR(8)    NOT NULL DEFAULT 'INR',
  tax_rate           DECIMAL(6,3)  NOT NULL DEFAULT 18, -- service tax note %
  total              DECIMAL(14,2) NOT NULL DEFAULT 0,  -- combined cost in INR
  payment_terms      VARCHAR(512)  NULL,               -- 60% advance, 20% ...
  validity_days      INT           NOT NULL DEFAULT 15,

  -- Signatories (cover letter vs commercial offer can differ).
  letter_signatory_name  VARCHAR(255) NULL,            -- Rajesh Khanna
  letter_signatory_title VARCHAR(255) NULL,            -- Managing Director
  offer_signatory_name   VARCHAR(255) NULL,            -- Venkat Manohar
  offer_signatory_title  VARCHAR(255) NULL,            -- Business Head - LBI (Route survey)

  notes              TEXT          NULL,

  issue_date         DATE          NOT NULL,
  sent_at            DATETIME      NULL,
  created_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_offer_user_number (user_id, offer_number),
  KEY idx_offer_user_created (user_id, created_at),
  KEY idx_offer_status (user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- One row per route in the commercial table (Sl. / Route).
CREATE TABLE IF NOT EXISTS offer_routes (
  id           BIGINT        NOT NULL AUTO_INCREMENT,
  offer_id     CHAR(36)      NOT NULL,
  position     INT           NOT NULL DEFAULT 0,
  route_text   VARCHAR(512)  NOT NULL,                 -- e.g. ISGEC- Yamunanagar, Haryana
  PRIMARY KEY (id),
  KEY idx_offer_routes (offer_id, position),
  CONSTRAINT fk_offer_routes_offer FOREIGN KEY (offer_id)
    REFERENCES offers (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Per-user, per-year quote-number counter (only used when the user leaves the
-- quote number blank). Incremented inside the create transaction with a row
-- lock so concurrent creates never collide.
CREATE TABLE IF NOT EXISTS offer_seq (
  user_id  CHAR(36) NOT NULL,
  yr       INT      NOT NULL,
  last_seq INT      NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, yr)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Optional per-user offer number prefix (e.g. RIPL/LBI/VK).
ALTER TABLE invoice_settings
  ADD COLUMN offer_prefix VARCHAR(64) NULL AFTER invoice_prefix;
