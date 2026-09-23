-- ---------------------------------------------------------------------
-- Proforma invoices: a company seal (stamp) next to the signature.
--
-- Each company already carries a logo and a signature image. Indian
-- proforma invoices are routinely expected to carry the company's round
-- seal as well, so it gets its own image: set once on the company
-- (invoice_settings) and snapshotted onto each invoice (proforma_invoices),
-- exactly like signature_path, so changing the seal later never alters an
-- invoice that has already gone out.
--
-- Guarded + idempotent (safe to re-run).
--
-- Apply with:
--   node scripts/apply-sql.mjs migrations/2026-09-23_invoice_company_seal.sql
-- ---------------------------------------------------------------------

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME   = 'invoice_settings'
              AND COLUMN_NAME  = 'seal_path');
SET @sql := IF(@c = 0,
  'ALTER TABLE invoice_settings ADD COLUMN seal_path VARCHAR(512) NULL AFTER signature_path',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME   = 'proforma_invoices'
              AND COLUMN_NAME  = 'seal_path');
SET @sql := IF(@c = 0,
  'ALTER TABLE proforma_invoices ADD COLUMN seal_path VARCHAR(512) NULL AFTER signature_path',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
