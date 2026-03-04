-- Add water_name field to water_jerrycans table for product tracking
-- MySQL compatible syntax (no IF NOT EXISTS for columns)
SET @dbname = DATABASE();
SET @tablename = 'water_jerrycans';
SET @columnname = 'water_name';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE water_jerrycans ADD COLUMN water_name VARCHAR(255)'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;
