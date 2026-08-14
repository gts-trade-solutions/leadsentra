-- ---------------------------------------------------------------------
-- Fix + re-run of 2026-06-25_backfill_bounced_status.sql.
--
-- The original matched `s.reason IN ('bounce','complaint')`, but `reason` is
-- the free-text note column ("SES bounce: Permanent — Mailbox does not exist").
-- The bounce/complaint enum lives in `suppressions.source`.  The JOIN therefore
-- matched zero rows and the migration was a silent no-op: bounces stayed
-- recorded only in `suppressions`, while every bounce number in the UI reads
-- from `campaign_recipients.status`.  That is why the app under-reported
-- bounces against the SES console.
--
-- Only `source = 'complaint'` and SES-originated bounces are backfilled.  Rows
-- the send loop wrote with source='bounce' for a LOCAL send failure (bad
-- credentials, unverified sender, throttling) are excluded — SES never saw
-- those messages, so counting them as bounces would over-report in the other
-- direction.  They stay 'failed', which is what they are.
--
-- Idempotent and scoped per owner. Safe to re-run.
-- ---------------------------------------------------------------------

UPDATE campaign_recipients cr
JOIN campaigns c ON c.id = cr.campaign_id
JOIN suppressions s
  ON s.user_id = c.user_id
 AND s.type = 'email'
 AND s.value = LOWER(cr.email)
 AND s.source IN ('bounce', 'complaint')
 AND s.reason NOT LIKE 'Send failed:%'
SET
  cr.status        = CASE WHEN s.source = 'complaint' THEN 'complained' ELSE 'bounced' END,
  cr.bounced_at    = CASE WHEN s.source = 'bounce'    THEN COALESCE(cr.bounced_at, s.created_at)   ELSE cr.bounced_at END,
  cr.complaint_at  = CASE WHEN s.source = 'complaint' THEN COALESCE(cr.complaint_at, s.created_at) ELSE cr.complaint_at END,
  cr.last_event_at = NOW()
WHERE cr.status IN ('sent', 'delivered', 'opened', 'clicked');
