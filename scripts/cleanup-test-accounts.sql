-- One-off cleanup of QA test accounts that leaked into the dev DB.
-- Idempotent: safe to run multiple times.

-- Capture ids before deleting parent rows
CREATE TEMPORARY TABLE IF NOT EXISTS _qa_user_ids AS
  SELECT id FROM users WHERE email IN (
    'qa-test-not-real-1778477663358@example.invalid',
    'qa-pw-1778477671722@example.invalid'
  );

-- Wipe wallets / ledger rows so we don't leave orphans
DELETE FROM credits_wallets WHERE user_id IN (SELECT id FROM _qa_user_ids);
DELETE FROM wallet          WHERE user_id IN (SELECT id FROM _qa_user_ids);
DELETE FROM credits_ledger  WHERE user_id IN (SELECT id FROM _qa_user_ids);

-- Finally remove the users
DELETE FROM users WHERE email IN (
  'qa-test-not-real-1778477663358@example.invalid',
  'qa-pw-1778477671722@example.invalid'
);

DROP TEMPORARY TABLE _qa_user_ids;
