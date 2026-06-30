-- ---------------------------------------------------------------------
-- Offer Templates (admin-managed, DB-backed)
--
-- An offer template is an ordered list of content BLOCKS (headings,
-- paragraphs, bullet lists, the route/cost table, banking, etc.) stored as
-- JSON. Block text may contain {{placeholders}} that are filled from the
-- offer's dynamic fields at render time — so every template REUSES the same
-- field set; only the layout/wording differs.
--
-- The built-in "RACE INTELLECT (LBI)" layout is seeded per-user on first use
-- (see lib/offerTemplatesRepo.ts). Each offer records which template it used.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS offer_templates (
  id          CHAR(36)     NOT NULL,
  user_id     CHAR(36)     NOT NULL,
  name        VARCHAR(255) NOT NULL,
  is_default  TINYINT(1)   NOT NULL DEFAULT 0,
  content     LONGTEXT     NOT NULL,            -- JSON array of blocks
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_offer_templates_user (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Which template an offer was built from (NULL -> fall back to the default).
ALTER TABLE offers
  ADD COLUMN template_id CHAR(36) NULL AFTER source;
