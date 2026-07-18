-- Contact type: distinguishes a "lead" (a contact you actively email in
-- lead-generation campaigns) from a "normal" CRM contact you keep on file but
-- do NOT bulk-email.
--
--   'lead'   => included as a recipient in lead-generation campaigns
--   'normal' => stored in the CRM but never pulled into a campaign audience
--
-- Existing rows default to 'normal': after this migration they stop being
-- mailed until tagged as leads (a deliberate opt-in choice — see the Add
-- Contact form, which defaults NEW contacts to 'lead'). Bulk CSV imports also
-- default their rows to 'lead' (they're lead lists) unless a type column says
-- otherwise.
--
-- Guarded + idempotent (safe to re-run).
--
-- Apply with:
--   node scripts/apply-sql2.mjs migrations/2026-07-18_contact_type.sql <envfile>

SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME   = 'contacts'
                AND COLUMN_NAME  = 'contact_type');
SET @sql := IF(@col = 0,
  'ALTER TABLE contacts
     ADD COLUMN contact_type VARCHAR(16) NOT NULL DEFAULT ''normal'' AFTER company_id,
     ADD KEY idx_contacts_type (contact_type)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
