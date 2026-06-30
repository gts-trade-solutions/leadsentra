-- ---------------------------------------------------------------------
-- Proforma Invoices
--
-- A seller (the signed-in user) issues a proforma invoice to a customer
-- (optionally linked to a CRM contact/company). The invoice is saved as a
-- draft, can be rendered to PDF, and emailed (HTML body + PDF attachment).
--
-- Seller details are SNAPSHOTTED onto the invoice at create time so later
-- edits to billing_profiles never rewrite the history of an issued invoice.
-- Money columns are DECIMAL to avoid float rounding on totals.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS proforma_invoices (
  id                 CHAR(36)      NOT NULL,
  user_id            CHAR(36)      NOT NULL,            -- seller / owner
  invoice_number     VARCHAR(64)   NOT NULL,           -- e.g. PI-2026-0001
  status             VARCHAR(16)   NOT NULL DEFAULT 'draft',  -- draft | sent

  -- Customer (recipient). *_id link back to CRM rows when picked from there.
  customer_contact_id CHAR(36)     NULL,
  customer_company_id CHAR(36)     NULL,
  customer_name      VARCHAR(255)  NULL,
  customer_email     VARCHAR(255)  NULL,
  customer_company   VARCHAR(255)  NULL,
  customer_gstin     VARCHAR(32)   NULL,
  customer_address   TEXT          NULL,

  -- Seller snapshot (copied from billing_profiles at create time).
  seller_name        VARCHAR(255)  NULL,
  seller_email       VARCHAR(255)  NULL,
  seller_phone       VARCHAR(64)   NULL,
  seller_company     VARCHAR(255)  NULL,
  seller_gstin       VARCHAR(32)   NULL,
  seller_address     TEXT          NULL,

  -- Dates / money
  issue_date         DATE          NOT NULL,
  valid_until        DATE          NULL,
  currency           VARCHAR(8)    NOT NULL DEFAULT 'INR',
  subtotal           DECIMAL(14,2) NOT NULL DEFAULT 0,
  discount           DECIMAL(14,2) NOT NULL DEFAULT 0,
  tax_rate           DECIMAL(6,3)  NOT NULL DEFAULT 0,   -- percent, e.g. 18.000
  tax_amount         DECIMAL(14,2) NOT NULL DEFAULT 0,
  total              DECIMAL(14,2) NOT NULL DEFAULT 0,

  notes              TEXT          NULL,
  terms              TEXT          NULL,

  sent_at            DATETIME      NULL,
  created_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_pi_user_number (user_id, invoice_number),
  KEY idx_pi_user_created (user_id, created_at),
  KEY idx_pi_status (user_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS proforma_invoice_items (
  id           BIGINT        NOT NULL AUTO_INCREMENT,
  invoice_id   CHAR(36)      NOT NULL,
  position     INT           NOT NULL DEFAULT 0,
  description  VARCHAR(512)  NOT NULL,
  hsn          VARCHAR(32)   NULL,                     -- HSN/SAC code (optional)
  quantity     DECIMAL(14,3) NOT NULL DEFAULT 1,
  unit_price   DECIMAL(14,2) NOT NULL DEFAULT 0,
  amount       DECIMAL(14,2) NOT NULL DEFAULT 0,       -- quantity * unit_price
  PRIMARY KEY (id),
  KEY idx_pii_invoice (invoice_id, position),
  CONSTRAINT fk_pii_invoice FOREIGN KEY (invoice_id)
    REFERENCES proforma_invoices (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Per-user, per-year invoice number counter. Incremented inside the create
-- transaction with a row lock so concurrent creates never collide on a number.
CREATE TABLE IF NOT EXISTS proforma_invoice_seq (
  user_id  CHAR(36) NOT NULL,
  yr       INT      NOT NULL,
  last_seq INT      NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, yr)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
