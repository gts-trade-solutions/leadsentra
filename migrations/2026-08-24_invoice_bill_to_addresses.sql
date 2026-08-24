-- ---------------------------------------------------------------------
-- Saved "Bill To" addresses (per user address book for proforma invoices).
--
-- The same customer is invoiced again and again, and every invoice meant
-- re-typing the name, phone, GSTIN and the full postal address. This table
-- keeps each customer once so a new invoice only needs them picked — by
-- label, name, city, phone or (most often) their EMAIL — and every customer
-- field on the form is filled in from the saved row.
--
-- Rows arrive two ways:
--   * typed by hand (Quick Add / Manage), or
--   * captured automatically the first time an invoice is raised for an
--     email address, so "sent once" is all it takes for the details to be
--     there next time.
--
-- The postal address is stored in parts (line1/line2/city/state/pincode)
-- rather than one blob so the Manage list can show city/state columns and
-- an auto-captured address can later be corrected field by field. It is
-- flattened back into the invoice's single "Billing address" box on prefill.
--
-- No unique key on email on purpose: two branches of one clinic legitimately
-- share a billing address, and a hard constraint would refuse the second one.
-- Auto-capture picks the most recently used row for an email instead.
--
-- Guarded + idempotent (safe to re-run).
--
-- Apply with:
--   node scripts/apply-sql.mjs migrations/2026-08-24_invoice_bill_to_addresses.sql
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS invoice_bill_to_addresses (
  id             CHAR(36)      NOT NULL,
  user_id        CHAR(36)      NOT NULL,            -- owner (the seller)

  `label`        VARCHAR(255)  NOT NULL,            -- what the picker lists
  `name`         VARCHAR(255)  NULL,                -- customer / contact name
  company        VARCHAR(255)  NULL,
  category       VARCHAR(64)   NULL,                -- free text: Clinic, Dealer, …

  email          VARCHAR(255)  NULL,
  phone          VARCHAR(64)   NULL,                -- free text: may hold two numbers
  gstin          VARCHAR(32)   NULL,
  pan            VARCHAR(32)   NULL,

  country        VARCHAR(64)   NULL,
  address_line1  VARCHAR(512)  NULL,
  address_line2  VARCHAR(512)  NULL,
  city           VARCHAR(128)  NULL,
  `state`        VARCHAR(128)  NULL,
  pincode        VARCHAR(16)   NULL,

  -- Kept when the address came from a CRM pick, so an invoice raised off it
  -- still links back to the contact/company it belongs to.
  contact_id     CHAR(36)      NULL,
  company_id     CHAR(36)      NULL,

  last_used_at   DATETIME      NULL,                -- drives "most recent first"
  created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  KEY idx_bta_user_used (user_id, last_used_at),
  KEY idx_bta_user_label (user_id, `label`),
  KEY idx_bta_user_email (user_id, email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------------------
-- Seed the book from invoices already issued.
--
-- Without this, "invoice them once and their details are there next time"
-- would only hold for invoices raised from today — every customer billed so
-- far would have to be re-typed one last time. One row per (user, email),
-- taken from that customer's most recent invoice, which is the version of
-- their details most likely to still be right.
--
-- Only runs while the book is empty, so re-applying this file cannot
-- duplicate rows or undo edits made since.
-- ---------------------------------------------------------------------

SET @seeded := (SELECT COUNT(*) FROM invoice_bill_to_addresses);
SET @sql := IF(@seeded = 0,
  'INSERT INTO invoice_bill_to_addresses
     (id, user_id, `label`, `name`, company, email, phone, gstin, pan,
      address_line1, country, last_used_at, created_at)
   SELECT UUID(), p.user_id,
          COALESCE(NULLIF(TRIM(p.customer_name), ''''),
                   NULLIF(TRIM(p.customer_company), ''''),
                   LOWER(TRIM(p.customer_email))),
          NULLIF(TRIM(p.customer_name), ''''),
          NULLIF(TRIM(p.customer_company), ''''),
          LOWER(TRIM(p.customer_email)),
          NULLIF(TRIM(p.customer_phone), ''''),
          NULLIF(TRIM(p.customer_gstin), ''''),
          NULLIF(TRIM(p.customer_pan), ''''),
          LEFT(NULLIF(TRIM(p.customer_address), ''''), 512),
          ''India'',
          p.created_at, p.created_at
     FROM proforma_invoices p
    WHERE p.customer_email IS NOT NULL
      AND TRIM(p.customer_email) <> ''''
      AND p.id = (SELECT p2.id
                    FROM proforma_invoices p2
                   WHERE p2.user_id = p.user_id
                     AND LOWER(TRIM(p2.customer_email)) = LOWER(TRIM(p.customer_email))
                   ORDER BY p2.created_at DESC, p2.id DESC
                   LIMIT 1)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
