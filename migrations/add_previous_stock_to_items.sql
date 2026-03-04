-- Add previous_stock column to items table
-- MySQL compatible syntax (no IF NOT EXISTS for columns)

SET @dbname = DATABASE();
SET @tablename = 'items';
SET @columnname = 'previous_stock';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE items ADD COLUMN previous_stock DECIMAL(15,3) DEFAULT 0'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- Initialize previous_stock with current stock for all items
UPDATE items SET previous_stock = stock WHERE previous_stock = 0 OR previous_stock IS NULL;
