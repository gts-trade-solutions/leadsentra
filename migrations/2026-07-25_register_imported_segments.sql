-- ---------------------------------------------------------------------
-- Register segment values that arrived by import.
--
-- The Companies filter and the edit form build their segment dropdown from
-- company_segments. Bulk import writes companies.segment directly without
-- registering the value, so an imported segment ("IT & Managed Services") is
-- stored on the row but missing from every dropdown — which reads as "the
-- segment is empty" in the UI.
--
-- Idempotent: INSERT IGNORE against the existing primary key.
-- ---------------------------------------------------------------------

INSERT IGNORE INTO company_segments (name)
SELECT DISTINCT TRIM(segment)
  FROM companies
 WHERE segment IS NOT NULL
   AND TRIM(segment) <> ''
   AND CHAR_LENGTH(TRIM(segment)) <= 64;
