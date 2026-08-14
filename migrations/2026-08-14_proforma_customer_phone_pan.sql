-- ---------------------------------------------------------------------
-- Proforma invoices: customer phone number and PAN.
--
-- The seller side already carries a PAN (seller_pan) and the invoice prints
-- a "PAN No" row for it, but there was nowhere to record the CUSTOMER's PAN
-- or phone — both of which are routinely needed on an Indian proforma, and
-- were being typed into the address block to get them onto the page.
--
-- Guarded + idempotent (safe to re-run).
--
-- Apply with:
--   node scripts/apply-sql.mjs migrations/2026-08-14_proforma_customer_phone_pan.sql
-- ---------------------------------------------------------------------

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME   = 'proforma_invoices'
              AND COLUMN_NAME  = 'customer_phone');
SET @sql := IF(@c = 0,
  'ALTER TABLE proforma_invoices ADD COLUMN customer_phone VARCHAR(64) NULL AFTER customer_email',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME   = 'proforma_invoices'
              AND COLUMN_NAME  = 'customer_pan');
SET @sql := IF(@c = 0,
  'ALTER TABLE proforma_invoices ADD COLUMN customer_pan VARCHAR(32) NULL AFTER customer_gstin',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
