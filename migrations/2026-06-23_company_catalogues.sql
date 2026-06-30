-- Catalogues & Offers: saved marketing items (an email message + an attached
-- file) that can be tagged to a company and one of its departments, then sent
-- to that company/department's contacts — or to every company ("overall").
--
-- company_id NULL  => applies to ALL companies (a global / "overall" item)
-- department NULL   => applies to ALL departments of the chosen company
--
-- Apply with:  node scripts/apply-sql.mjs migrations/2026-06-23_company_catalogues.sql

CREATE TABLE IF NOT EXISTS company_catalogues (
  id          CHAR(36)      NOT NULL,
  user_id     CHAR(36)      NULL,                 -- owner / uploader (null = legacy/global)
  kind        VARCHAR(16)   NOT NULL DEFAULT 'catalogue',  -- 'catalogue' | 'offer'
  title       VARCHAR(255)  NOT NULL,
  subject     VARCHAR(255)  NULL,                 -- email subject line
  body        MEDIUMTEXT    NULL,                 -- email HTML body
  company_id  CHAR(36)      NULL,                 -- NULL = all companies ("overall")
  department  VARCHAR(128)  NULL,                 -- NULL = all departments
  file_name   VARCHAR(255)  NULL,                 -- original uploaded filename
  file_path   VARCHAR(512)  NULL,                 -- public URL path, e.g. /uploads/catalogues/<uuid>.pdf
  file_type   VARCHAR(128)  NULL,                 -- MIME type
  file_size   INT           NULL,                 -- bytes
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_catalogues_company (company_id),
  KEY idx_catalogues_user (user_id),
  KEY idx_catalogues_dept (department)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
