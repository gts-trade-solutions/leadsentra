-- ---------------------------------------------------------------------
-- Invoice settings become COMPANY PROFILES: a user can invoice as more than
-- one company.
--
-- invoice_settings held exactly one row per user (PRIMARY KEY user_id), so
-- "my company" was a single identity — change it and every past default was
-- overwritten, and there was no way to keep two sets of details and pick
-- between them per invoice. This turns that row into one of many: each row is
-- a company (name, address, GSTIN, PAN, email, phone, bank details, logo,
-- signature, invoice prefix), one of them flagged as the default.
--
-- The existing row becomes that user's first company, marked default, so
-- nothing about the current behaviour changes until a second one is added.
-- Every read that used to take "the row for this user" now takes the default
-- one, which is the same row.
--
-- Invoice numbering is also split per company: the counter was keyed
-- (user_id, yr), so two companies with different prefixes would have shared
-- one series and each would show gaps. It is now keyed by prefix as well, and
-- existing counters are backfilled with the user's current prefix so the
-- running series continues unbroken rather than restarting at 1.
--
-- Guarded + idempotent (safe to re-run). It changes two PRIMARY KEYs, so take
-- a dump first:
--   mysqldump -u <user> -p <db> invoice_settings proforma_invoice_seq > backup.sql
--
-- Apply with:
--   node scripts/apply-sql.mjs migrations/2026-08-24_invoice_company_profiles.sql
-- ---------------------------------------------------------------------

-- 1. New columns: the row's own id, a name for the picker, and the default flag.
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME   = 'invoice_settings'
              AND COLUMN_NAME  = 'id');
SET @sql := IF(@c = 0,
  'ALTER TABLE invoice_settings
     ADD COLUMN id         CHAR(36)     NULL FIRST,
     ADD COLUMN `label`    VARCHAR(255) NULL AFTER id,
     ADD COLUMN is_default TINYINT(1)   NOT NULL DEFAULT 0 AFTER `label`',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 2. Fill them in for the rows that already exist. UUID() is evaluated per
--    row, so each gets its own id. Every existing row is the user's only
--    company, so it is their default.
UPDATE invoice_settings SET id = UUID() WHERE id IS NULL OR id = '';
UPDATE invoice_settings
   SET `label` = COALESCE(NULLIF(TRIM(seller_company), ''), 'My company')
 WHERE `label` IS NULL OR `label` = '';
UPDATE invoice_settings SET is_default = 1 WHERE is_default <> 1;

-- 3. Swap the primary key from user_id to id, so a user can hold several rows.
SET @pk_on_user := (SELECT COUNT(*) FROM information_schema.STATISTICS
                     WHERE TABLE_SCHEMA = DATABASE()
                       AND TABLE_NAME   = 'invoice_settings'
                       AND INDEX_NAME   = 'PRIMARY'
                       AND COLUMN_NAME  = 'user_id');
SET @sql := IF(@pk_on_user = 1,
  'ALTER TABLE invoice_settings
     DROP PRIMARY KEY,
     MODIFY id CHAR(36) NOT NULL,
     ADD PRIMARY KEY (id),
     ADD KEY idx_is_user (user_id, is_default, created_at)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 4. Invoice numbers run per company prefix, not per user.
SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME   = 'proforma_invoice_seq'
              AND COLUMN_NAME  = 'prefix_key');
SET @sql := IF(@c = 0,
  'ALTER TABLE proforma_invoice_seq
     ADD COLUMN prefix_key VARCHAR(64) NOT NULL DEFAULT '''' AFTER user_id',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 5. Point each existing counter at the prefix it has been counting all along,
--    so the next number continues the series instead of colliding with an
--    invoice number already issued.
UPDATE proforma_invoice_seq q
  JOIN invoice_settings s
    ON s.user_id = q.user_id AND s.is_default = 1
   SET q.prefix_key = COALESCE(NULLIF(TRIM(TRAILING '/' FROM TRIM(s.invoice_prefix)), ''), '')
 WHERE q.prefix_key = '';

SET @pk_on_prefix := (SELECT COUNT(*) FROM information_schema.STATISTICS
                       WHERE TABLE_SCHEMA = DATABASE()
                         AND TABLE_NAME   = 'proforma_invoice_seq'
                         AND INDEX_NAME   = 'PRIMARY'
                         AND COLUMN_NAME  = 'prefix_key');
SET @sql := IF(@pk_on_prefix = 0,
  'ALTER TABLE proforma_invoice_seq
     DROP PRIMARY KEY,
     ADD PRIMARY KEY (user_id, prefix_key, yr)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
