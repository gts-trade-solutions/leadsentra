-- ---------------------------------------------------------------------
-- Backfill: correct campaign_recipients that actually bounced/complained
-- but are still showing as sent/delivered (because the bounce was recorded
-- in suppressions but the recipient row was never flipped).
--
-- For every recipient whose email is on its campaign owner's suppression list
-- with a bounce/complaint reason, set the row to bounced/complained. Idempotent
-- and scoped per owner. Safe to re-run.
-- ---------------------------------------------------------------------

UPDATE campaign_recipients cr
JOIN campaigns c ON c.id = cr.campaign_id
JOIN suppressions s
  ON s.user_id = c.user_id
 AND s.type = 'email'
 AND s.value = LOWER(cr.email)
 AND s.reason IN ('bounce', 'complaint')
SET
  cr.status       = CASE WHEN s.reason = 'complaint' THEN 'complained' ELSE 'bounced' END,
  cr.bounced_at   = CASE WHEN s.reason = 'bounce'    THEN NOW() ELSE cr.bounced_at END,
  cr.complaint_at = CASE WHEN s.reason = 'complaint' THEN NOW() ELSE cr.complaint_at END,
  cr.last_event_at = NOW()
WHERE cr.status IN ('sent', 'delivered', 'opened', 'clicked');
