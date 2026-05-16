-- Segment classification for companies (Truck, Bus, Agriculture, ...).
-- Independent of `industry` (which is free-form like "EV Charging Infrastructure").
-- Stored as a column on companies + a lookup table for dropdown choices.

-- 1. Add `segment` column to companies (idempotent).
SET @col := (SELECT COUNT(*) FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE()
                AND TABLE_NAME   = 'companies'
                AND COLUMN_NAME  = 'segment');
SET @sql := IF(@col = 0,
  'ALTER TABLE companies ADD COLUMN segment VARCHAR(64) NULL AFTER industry, ADD KEY idx_companies_segment (segment)',
  'SELECT 1'
);
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. Lookup table for the segment dropdown.
CREATE TABLE IF NOT EXISTS company_segments (
  name        VARCHAR(64)  NOT NULL,
  created_by  CHAR(36)     NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. Seed with the initial set the user supplied.
INSERT IGNORE INTO company_segments (name) VALUES
  ('Truck'),
  ('Bus'),
  ('Agriculture'),
  ('Construction'),
  ('Bike'),
  ('Car'),
  ('Autocomponent'),
  ('Tyre'),
  ('Body Builders'),
  ('Commercial Vehicles');
