-- ---------------------------------------------------------------------
-- Company Memberships (join requests + approvals)
--
-- A user requests to JOIN an existing company (picked at signup or later from
-- the Company Access page). The request lands as `pending`; a platform admin
-- approves or rejects it. Approved companies become visible/selectable to the
-- user (the /api/companies listing includes them). A user can hold memberships
-- in several companies — one row per (user, company).
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS company_memberships (
  id           CHAR(36)     NOT NULL,
  user_id      CHAR(36)     NOT NULL,
  company_id   CHAR(36)     NOT NULL,
  status       VARCHAR(16)  NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  note         VARCHAR(512) NULL,                          -- optional admin note / reason
  requested_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  decided_at   DATETIME     NULL,
  decided_by   CHAR(36)     NULL,                          -- admin user id
  PRIMARY KEY (id),
  UNIQUE KEY uq_membership_user_company (user_id, company_id),
  KEY idx_membership_status (status),
  KEY idx_membership_company (company_id),
  KEY idx_membership_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
