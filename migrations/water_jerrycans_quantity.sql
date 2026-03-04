-- Migration: Change water_jerrycans from individual rows to quantity-based
-- This reduces database size significantly
-- MySQL compatible syntax (no IF NOT EXISTS for columns)

-- Add quantity column if it doesn't exist
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

-- Create a new consolidated table structure
-- First, consolidate existing rows into quantity-based records
-- This query groups existing bottles and sums them

-- Step 1: Create temp table with consolidated data
CREATE TEMPORARY TABLE temp_consolidated AS
SELECT 
  water_name,
  capacity,
  status,
  MAX(selling_price) as selling_price,
  MAX(bottle_price) as bottle_price,
  MAX(bottle_health) as bottle_health,
  COUNT(*) as quantity,
  MAX(created_at) as created_at
FROM water_jerrycans
GROUP BY water_name, capacity, status;

-- Step 2: Delete all existing rows
DELETE FROM water_jerrycans;

-- Step 3: Insert consolidated rows
INSERT INTO water_jerrycans (water_name, capacity, status, selling_price, bottle_price, bottle_health, quantity, serial_number, created_at)
SELECT 
  water_name,
  capacity,
  status,
  selling_price,
  bottle_price,
  bottle_health,
  quantity,
  CONCAT('STOCK-', water_name, '-', capacity, 'L-', status),
  created_at
FROM temp_consolidated;

-- Step 4: Drop temp table
DROP TEMPORARY TABLE temp_consolidated;
