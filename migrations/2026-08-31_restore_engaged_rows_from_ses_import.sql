-- ---------------------------------------------------------------------
-- Undo the part of the SES suppression import that overwrote real engagement.
--
-- scripts/import-ses-suppressions.mjs (and the /api/suppressions/sync-ses
-- route) re-marked every recipient row for an SES-suppressed address as
-- 'bounced', matching on:
--
--     cr.status IN ('sent', 'delivered', 'opened', 'clicked')
--
-- That range was wrong. The SES account suppression list says the address is
-- undeliverable NOW; it says nothing about a send from six months ago. A row
-- carrying opened_at or clicked_at is proof that message WAS received and
-- read, so rewriting it to 'bounced' erased a genuine open or click and made
-- past campaigns look worse than they were.
--
-- Both callers now exclude engaged rows. This repairs the ones already
-- changed by the first run.
--
-- Identification is exact: only rows the import itself wrote carry that
-- error_reason string verbatim, and only alongside an open or a click. Real
-- bounces recorded by the SES webhook have a different error_reason and are
-- untouched.
--
-- The address stays on the suppression list either way — it genuinely is
-- undeliverable today, and nothing here makes it mailable again.
--
-- Idempotent. Safe to re-run.
-- ---------------------------------------------------------------------

UPDATE campaign_recipients
   SET status = CASE
                  WHEN clicked_at IS NOT NULL OR clicks_count > 0 THEN 'clicked'
                  ELSE 'opened'
                END,
       -- bounced_at was set by the same statement; clear it so the row does not
       -- read as both engaged and bounced.
       bounced_at   = NULL,
       error_reason = NULL,
       last_event_at = COALESCE(clicked_at, opened_at, last_event_at)
 WHERE status = 'bounced'
   AND error_reason = 'On the SES account suppression list (permanent bounce or complaint)'
   AND (
        opened_at    IS NOT NULL
     OR clicked_at   IS NOT NULL
     OR opens_count  > 0
     OR clicks_count > 0
   );
