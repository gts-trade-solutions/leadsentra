-- ---------------------------------------------------------------------
-- Proforma Invoices v2
--
-- Adds the India-style template fields (PAN, payment/delivery terms, REF,
-- bank details, declaration + signatory, logo/signature) plus an "upload"
-- source so a user can attach their own ready-made PDF instead of a generated
-- one. Also adds a reusable per-user invoice_settings profile so those fields
-- pre-fill and snapshot onto each invoice.
-- ---------------------------------------------------------------------

-- Reusable seller defaults for invoices (separate from billing_profiles so the
-- existing payments billing flow is untouched).
CREATE TABLE IF NOT EXISTS invoice_settings (
  user_id        CHAR(36)      NOT NULL,
  seller_company VARCHAR(255)  NULL,
  seller_address TEXT          NULL,
  gstin          VARCHAR(32)   NULL,
  pan            VARCHAR(32)   NULL,
  email          VARCHAR(255)  NULL,
  phone          VARCHAR(64)   NULL,
  bank_name      VARCHAR(255)  NULL,
  bank_account   VARCHAR(64)   NULL,
  bank_branch    VARCHAR(255)  NULL,
  bank_ifsc      VARCHAR(32)   NULL,
  payment_terms  VARCHAR(512)  NULL,
  delivery_terms VARCHAR(255)  NULL,
  declaration    TEXT          NULL,
  signatory_name VARCHAR(255)  NULL,
  logo_path      VARCHAR(512)  NULL,
  signature_path VARCHAR(512)  NULL,
  invoice_prefix VARCHAR(32)   NULL,            -- e.g. RIPL/PI  -> RIPL/PI/2026/09
  created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Snapshot columns on each invoice.
ALTER TABLE proforma_invoices
  ADD COLUMN source         VARCHAR(16)  NOT NULL DEFAULT 'generated' AFTER status,  -- generated | upload
  ADD COLUMN pdf_path       VARCHAR(512) NULL,                          -- for uploaded PDFs
  ADD COLUMN seller_pan     VARCHAR(32)  NULL,
  ADD COLUMN ref            VARCHAR(255) NULL,
  ADD COLUMN payment_terms  VARCHAR(512) NULL,
  ADD COLUMN delivery_terms VARCHAR(255) NULL,
  ADD COLUMN bank_name      VARCHAR(255) NULL,
  ADD COLUMN bank_account   VARCHAR(64)  NULL,
  ADD COLUMN bank_branch    VARCHAR(255) NULL,
  ADD COLUMN bank_ifsc      VARCHAR(32)  NULL,
  ADD COLUMN declaration    TEXT         NULL,
  ADD COLUMN signatory_name VARCHAR(255) NULL,
  ADD COLUMN logo_path      VARCHAR(512) NULL,
  ADD COLUMN signature_path VARCHAR(512) NULL;

-- Part/SKU number per line, matching the "part no" column on the template.
ALTER TABLE proforma_invoice_items
  ADD COLUMN part_no VARCHAR(128) NULL AFTER position;
