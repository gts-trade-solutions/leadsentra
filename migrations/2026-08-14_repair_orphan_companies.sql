-- ---------------------------------------------------------------------
-- Repair: contacts pointing at companies that don't exist.
--
-- Contacts carry a company_id like "SWE02" or "UK01", but for some of them no
-- matching row was ever created in `companies`. Every company dropdown in the
-- app is fed from `companies`, so those companies simply cannot be picked —
-- which is why "most companies are not showing" in the signup picker, the
-- audience filter and the contact form, even though contacts clearly belong
-- to them.
--
-- (The current contacts importer already refuses to write an unknown
-- company_id — it saves the contact without a company and reports the row —
-- so these are historical rows from before that guard, or from a direct load.)
--
-- This creates the missing company rows, named after the code so they are
-- visible and can be renamed in the UI. Ownership is taken from the contacts
-- that reference them, so the existing visibility rules apply unchanged.
--
-- Idempotent: re-running inserts nothing once the rows exist.
--
-- To see what it WOULD create before running it:
--   SELECT c.company_id, COUNT(*) AS contacts
--     FROM contacts c
--     LEFT JOIN companies co ON co.company_id = c.company_id
--    WHERE c.company_id IS NOT NULL AND TRIM(c.company_id) <> ''
--      AND co.company_id IS NULL
--    GROUP BY c.company_id ORDER BY contacts DESC;
--
-- Apply with:
--   node scripts/apply-sql.mjs migrations/2026-08-14_repair_orphan_companies.sql
-- ---------------------------------------------------------------------

INSERT INTO companies (company_id, user_id, company_name)
SELECT c.company_id,
       MIN(c.user_id)  AS user_id,
       c.company_id    AS company_name
  FROM contacts c
  LEFT JOIN companies co ON co.company_id = c.company_id
 WHERE c.company_id IS NOT NULL
   AND TRIM(c.company_id) <> ''
   AND co.company_id IS NULL
 GROUP BY c.company_id;
