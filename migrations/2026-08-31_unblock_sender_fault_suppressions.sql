-- ---------------------------------------------------------------------
-- Release addresses that were blacklisted for someone else's mistake.
--
-- The campaign send loop used to write a suppression row on ANY send failure:
--
--     INSERT IGNORE INTO suppressions (...) VALUES (?, 'email', ?, ?, 'bounce')
--
-- including failures that had nothing to do with the recipient — an unverified
-- sender identity, expired AWS credentials, an SES throttle, a network blip.
-- One such error partway through a batch permanently blocked every remaining
-- valid customer in it, and they then appeared under "bounced" on the tracking
-- page, inflating the bounce numbers against what the SES console reports.
--
-- The send route now suppresses only on recipient-level rejections
-- (isRecipientFault in app/api/campaigns/[campaignId]/send/route.ts). This
-- migration cleans up the rows the old behaviour already wrote.
--
-- These rows are marked `corrected` rather than deleted: loadSuppressionSet
-- skips corrected rows, so the addresses become mailable again, and the row
-- stays for audit and is visible under the "Corrected" tab.
--
-- Rows recorded from a REAL bounce or complaint are untouched — the filter
-- requires the "Send failed:" prefix the send loop wrote, and only matches the
-- account-level error text.
--
-- Idempotent. Safe to re-run.
-- ---------------------------------------------------------------------

UPDATE suppressions
   SET corrected    = 1,
       corrected_at = NOW(),
       reason       = CONCAT('[auto-released: sender-side failure, not a bounce] ',
                             LEFT(COALESCE(reason, ''), 200)),
       updated_at   = NOW()
 WHERE source = 'bounce'
   AND (corrected IS NULL OR corrected = 0)
   AND reason LIKE 'Send failed:%'
   AND reason NOT LIKE '%auto-released%'
   AND (
        reason LIKE '%not verified%'
     OR reason LIKE '%Throttl%'
     OR reason LIKE '%rate exceeded%'
     OR reason LIKE '%Maximum sending rate%'
     OR reason LIKE '%quota%'
     OR reason LIKE '%credential%'
     OR reason LIKE '%signature%'
     OR reason LIKE '%AccessDenied%'
     OR reason LIKE '%not authorized%'
     OR reason LIKE '%account is paused%'
     OR reason LIKE '%Sending paused%'
     OR reason LIKE '%No email provider configured%'
     OR reason LIKE '%AWS_ACCESS_KEY_ID%'
     OR reason LIKE '%ETIMEDOUT%'
     OR reason LIKE '%ECONNRESET%'
     OR reason LIKE '%timeout%'
   );

-- Those recipients were marked 'failed' at send time, which is accurate — the
-- message really did not go out. Put them back in the queue ONLY if their
-- campaign never finished, so a retry picks them up. Campaigns already marked
-- 'sent' are left alone; re-queueing them would re-charge credits.
UPDATE campaign_recipients cr
  JOIN campaigns c ON c.id = cr.campaign_id
  JOIN suppressions s
    ON s.user_id = c.user_id
   AND s.type    = 'email'
   AND s.value   = LOWER(cr.email)
   AND s.corrected = 1
   AND s.reason LIKE '[auto-released:%'
   SET cr.status        = 'queued',
       cr.error_reason  = NULL,
       cr.last_event_at = NOW()
 WHERE cr.status = 'failed'
   AND c.status IN ('draft', 'sending', 'failed');
