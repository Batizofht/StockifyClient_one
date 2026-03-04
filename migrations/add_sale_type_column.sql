-- Migration: Add sale_type column to sales table
-- MySQL compatible syntax (no IF NOT EXISTS for columns)

SET @dbname = DATABASE();
SET @tablename = 'sales';
SET @columnname = 'sale_type';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  "ALTER TABLE sales ADD COLUMN sale_type ENUM('retail', 'wholesale') DEFAULT 'retail'"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;
