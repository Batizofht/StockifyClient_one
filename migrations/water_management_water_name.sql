-- Add water name (brand) and product-based selling
-- Run this after water_management.sql (run once)
-- MySQL compatible syntax (no IF NOT EXISTS for columns)

SET @dbname = DATABASE();

-- Jerrycans: add water name (e.g. Jibu)
SET @tablename = 'water_jerrycans';
SET @columnname = 'water_name';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  "ALTER TABLE water_jerrycans ADD COLUMN water_name VARCHAR(100) DEFAULT 'Water'"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- Additions: add water name
SET @tablename = 'water_additions';
SET @columnname = 'water_name';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  "ALTER TABLE water_additions ADD COLUMN water_name VARCHAR(100) DEFAULT 'Water'"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- Additions: add status
SET @columnname = 'status';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  "ALTER TABLE water_additions ADD COLUMN status VARCHAR(20) DEFAULT 'filled'"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- Sales: add water_name
SET @tablename = 'water_sales';
SET @columnname = 'water_name';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  "ALTER TABLE water_sales ADD COLUMN water_name VARCHAR(100) DEFAULT 'Water'"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- Sales: add capacity
SET @columnname = 'capacity';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE water_sales ADD COLUMN capacity INT DEFAULT 20'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- Backfill existing rows
UPDATE water_jerrycans SET water_name = COALESCE(water_name, 'Water') WHERE water_name IS NULL OR water_name = '';
UPDATE water_additions SET water_name = COALESCE(water_name, 'Water'), status = COALESCE(status, 'filled') WHERE water_name IS NULL OR water_name = '';
UPDATE water_sales SET water_name = COALESCE(water_name, 'Water'), capacity = COALESCE(capacity, 20) WHERE water_name IS NULL OR water_name = '';
