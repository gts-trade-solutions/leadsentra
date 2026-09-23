-- ---------------------------------------------------------------------
-- Race Innovations for the staff logins that raise its invoices.
--
-- Companies are per login, and 2026-09-23_seed_race_innovations_company.sql
-- saved Race Innovations only under info@raceinnovations.in. Staff who raise
-- invoices from their own login could not find it: their company list held
-- only an unnamed row (a bank block saved from an invoice), which pre-fills
-- the form with nothing.
--
-- For each login listed below this:
--   1. adds Race Innovations (same details as the first seed), unless that
--      login already has it;
--   2. makes it the login's default company, but only when the current
--      default has no company name — a real default someone chose is kept.
--
-- To give another login the company, add its email to BOTH lists below and
-- re-run. Safe to re-run: nothing is duplicated.
--
-- Apply with:
--   node scripts/apply-sql.mjs migrations/2026-09-23_seed_race_innovations_staff_logins.sql
-- ---------------------------------------------------------------------

INSERT INTO invoice_settings
  (id, user_id, `label`, is_default,
   seller_company, seller_address, gstin, pan, email,
   bank_name, bank_account, bank_branch, bank_ifsc,
   payment_terms, delivery_terms, signatory_name)
SELECT UUID(), u.id, 'Race Innovations',
       IF(EXISTS (SELECT 1 FROM invoice_settings d WHERE d.user_id = u.id), 0, 1),
       'RACE INNOVATIONS PVT LTD',
       CONCAT('Office No : 928, Regus Olympia Platina', '\n',
              '9th Floor, Olympia Platina,', '\n',
              'Plot No : 33-B South Phase,', '\n',
              'Guindy Industrial Estate, Chennai 600032'),
       '33AAFCR6885E1Z6',
       'AAFCR6885E',
       'info@raceinnovations.in',
       'ICICI Bank',
       '218505001924',
       'Saidapet, Chennai',
       'ICIC0002185',
       '60% advance / 20% against Survey completion / balance against report submission / review/ clearance at our portal.',
       'In PDF format with our logo',
       'Rajesh'
  FROM users u
 WHERE LOWER(u.email) IN ('evanjalineraceinnovations@gmail.com')
   AND NOT EXISTS (
         SELECT 1 FROM invoice_settings s
          WHERE s.user_id = u.id
            AND REGEXP_REPLACE(LOWER(COALESCE(s.seller_company, '')), '[^a-z0-9]', '')
                LIKE 'raceinnovations%'
       );

-- Make it the default where the current default is an unnamed row. The two
-- derived tables are materialised first, which is what lets MySQL read
-- invoice_settings while updating it.
UPDATE invoice_settings s
  JOIN users u
    ON u.id = s.user_id
   AND LOWER(u.email) IN ('evanjalineraceinnovations@gmail.com')
  JOIN (SELECT user_id, MIN(id) AS race_id
          FROM invoice_settings
         WHERE REGEXP_REPLACE(LOWER(COALESCE(seller_company, '')), '[^a-z0-9]', '')
               LIKE 'raceinnovations%'
         GROUP BY user_id) r
    ON r.user_id = s.user_id
  LEFT JOIN (SELECT DISTINCT user_id
               FROM invoice_settings
              WHERE is_default = 1
                AND TRIM(COALESCE(seller_company, '')) <> '') named
    ON named.user_id = s.user_id
   SET s.is_default = (s.id = r.race_id)
 WHERE named.user_id IS NULL;
