-- ---------------------------------------------------------------------
-- Proforma invoices: subject line + separate GST / IGST
--
-- The manual builder now captures a "Sub:" line (like the offer letter's
-- subject) and two independent tax rates: GST and IGST. Both are charged on
-- (subtotal - discount); either can be left at 0. The existing tax_rate /
-- tax_amount columns keep holding the GST leg so historical rows are unchanged.
-- ---------------------------------------------------------------------

ALTER TABLE proforma_invoices
  ADD COLUMN subject     VARCHAR(512)  NULL              AFTER invoice_number,
  ADD COLUMN igst_rate   DECIMAL(6,3)  NOT NULL DEFAULT 0 AFTER tax_amount,   -- percent, e.g. 18.000
  ADD COLUMN igst_amount DECIMAL(14,2) NOT NULL DEFAULT 0 AFTER igst_rate;
