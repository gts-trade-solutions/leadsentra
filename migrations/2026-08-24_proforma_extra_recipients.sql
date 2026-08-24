-- ---------------------------------------------------------------------
-- Proforma invoices: send to more than one person.
--
-- customer_email is the customer of record — one address, the one the list
-- shows and the one a contact is matched on. An invoice routinely has to
-- reach billing AND procurement AND the person who asked for it, so the
-- extra addresses get their own column instead of being crammed into
-- customer_email (255 chars, and it would break matching a contact by email).
--
-- Stored as a comma-separated list; every address is validated before it is
-- written and again before a send.
--
-- Guarded + idempotent (safe to re-run).
--
-- Apply with:
--   node scripts/apply-sql.mjs migrations/2026-08-24_proforma_extra_recipients.sql
-- ---------------------------------------------------------------------

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME   = 'proforma_invoices'
              AND COLUMN_NAME  = 'extra_recipients');
SET @sql := IF(@c = 0,
  'ALTER TABLE proforma_invoices ADD COLUMN extra_recipients VARCHAR(1024) NULL AFTER customer_email',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
