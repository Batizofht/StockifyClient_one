-- Add quantity column to water_jerrycans table for quantity-based tracking
-- MySQL compatible syntax (no IF NOT EXISTS for columns)

SET @dbname = DATABASE();
SET @tablename = 'water_jerrycans';
SET @columnname = 'quantity';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE water_jerrycans ADD COLUMN quantity INT DEFAULT 1'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- Update existing rows to have quantity = 1
UPDATE water_jerrycans SET quantity = 1 WHERE quantity IS NULL;
