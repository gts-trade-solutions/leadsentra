-- ---------------------------------------------------------------------
-- Super admin + delete approvals.
--
-- Deleting shared business data was something any admin could do on their own,
-- and nothing recorded that it had happened. This adds a role above admin and
-- a queue: an admin's delete becomes a request, and only a super admin can
-- approve it — at which point the deletion is carried out and the row keeps a
-- permanent record of who asked, who approved, and what it removed.
--
-- `users.role` is a VARCHAR, not an ENUM, so 'super_admin' needs no column
-- change. Roles now rank: super_admin > admin > moderator > user. Code treats
-- super_admin as an admin everywhere (lib/admin.ts isAdmin), so a super admin
-- keeps every power an admin has.
--
-- Guarded + idempotent (safe to re-run).
--
-- Apply with:
--   node scripts/apply-sql.mjs migrations/2026-08-26_super_admin_delete_requests.sql
-- ---------------------------------------------------------------------

-- 1. The approval queue.
--
--    `payload` carries whatever the executor needs to carry out the deletion
--    later — the id list for a bulk delete, the vocabulary for a list value.
--    Keeping it as JSON means a new deletable resource needs no column change.
--
--    `label` is the human name AS IT WAS when the request was made, so the
--    queue still reads sensibly for a row that has since been renamed, and a
--    decided request still says what it was about after the row is gone.
CREATE TABLE IF NOT EXISTS delete_requests (
  id            CHAR(36)     NOT NULL,
  requested_by  CHAR(36)     NOT NULL,
  resource      VARCHAR(32)  NOT NULL,           -- company | contact | invoice | ...
  resource_id   VARCHAR(191) NOT NULL DEFAULT '',-- the target row, '' for a bulk request
  payload       TEXT         NULL,               -- JSON: extra the executor needs
  label         VARCHAR(255) NULL,               -- human name at request time
  reason        VARCHAR(512) NULL,               -- why the admin wants it gone
  status        VARCHAR(16)  NOT NULL DEFAULT 'pending',  -- pending | approved | rejected | failed
  decided_by    CHAR(36)     NULL,
  decided_at    DATETIME     NULL,
  decision_note VARCHAR(512) NULL,
  outcome       VARCHAR(512) NULL,               -- what running it actually did
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_status    (status, created_at),
  KEY idx_requester (requested_by, created_at),
  KEY idx_target    (resource, resource_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. Promote the first super admin.
--
--    This has to happen in the same step that introduces the gate: an admin's
--    delete now needs an approver, so shipping the queue without anyone able
--    to approve would leave every request stuck pending.
--
--    EDIT THIS EMAIL if the super admin on your deployment is someone else.
--    Runs only against an account that already exists, so it is a no-op on a
--    database where that address was never registered.
UPDATE users
   SET role = 'super_admin'
 WHERE email = 'raceautoindia@gmail.com'
   AND role <> 'super_admin';
