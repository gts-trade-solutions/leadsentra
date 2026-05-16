-- Credit pricing v2 (planner-approved 2026-05-12)
--
-- - Lower contact_unlock to Apollo-tier (2 cr).
-- - Promote asset_financials / asset_forecast to first-class rows.
-- - Re-price mgmt_pack as a real bundle (25 cr).
-- - Introduce email_send_batch: 1 credit per 50 recipients per send job.
--   The 50 batch size is hardcoded in app/api/campaigns/[campaignId]/send/route.ts
--   as EMAIL_BATCH_SIZE so the per-batch rate in this table stays meaningful.
-- - Retire (but keep) the old `email_send` row so any external scripts that
--   query it don't 500 — nothing in our code reads it now.

INSERT INTO credits_prices (feature, price) VALUES
  ('contact_unlock',      2),
  ('asset_phone',         1),
  ('asset_email',         1),
  ('asset_financials',   10),
  ('asset_forecast',     10),
  ('asset_mgmt_pack',    25),
  ('email_send_batch',    1),
  ('email_send',          1),  -- retired, kept for back-compat queries
  ('ai_draft',            2),
  ('ai_image',            5),
  ('facebook_post',       1),
  ('linkedin_post',       1)
ON DUPLICATE KEY UPDATE price = VALUES(price);
