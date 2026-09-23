-- ---------------------------------------------------------------------
-- Race Innovations as a saved invoicing company for info@raceinnovations.in.
--
-- Adds one company profile (invoice_settings row) under that login, so the
-- proforma-invoice form can pick it by name instead of the details being
-- typed on every invoice. Values are taken from Race Innovations' own
-- proforma invoice (RIPL/PI/2026-27/73). Logo, signature and seal are
-- uploaded afterwards under Invoices -> Settings.
--
-- No invoice prefix is set: Race numbers run RIPL/PI/2026-27/73, while the
-- app formats <prefix>/<year>/<nn> from 01, which could repeat numbers
-- already issued. Type the number on each invoice, or set a prefix later.
--
-- Safe to re-run: it inserts nothing when that login does not exist in this
-- database, or when it already has a company named Race Innovations
-- (punctuation and case ignored). It becomes the default company only if the
-- login has no company yet.
--
-- Apply with:
--   node scripts/apply-sql.mjs migrations/2026-09-23_seed_race_innovations_company.sql
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
 WHERE LOWER(u.email) = 'info@raceinnovations.in'
   AND NOT EXISTS (
         SELECT 1 FROM invoice_settings s
          WHERE s.user_id = u.id
            AND REGEXP_REPLACE(LOWER(COALESCE(s.seller_company, '')), '[^a-z0-9]', '')
                LIKE 'raceinnovations%'
       );
