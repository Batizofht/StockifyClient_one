-- Backfill schema pieces that were previously created at runtime inside routes
-- This keeps DB setup reproducible from migration scripts.

SET @dbname = DATABASE();

-- ============================================================
-- water_bottle_items table (used heavily by waterManagement routes)
-- ============================================================
CREATE TABLE IF NOT EXISTS water_bottle_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  water_name VARCHAR(100) NOT NULL,
  capacity_liters DECIMAL(10, 2) NOT NULL DEFAULT 1.0,
  bottle_type VARCHAR(50) NOT NULL DEFAULT 'plastic',
  buying_price DECIMAL(10, 2) NOT NULL DEFAULT 0,
  selling_price DECIMAL(10, 2) NOT NULL DEFAULT 0,
  bottle_selling_price DECIMAL(10, 2) NOT NULL DEFAULT 0,
  bottle_cost DECIMAL(10, 2) NOT NULL DEFAULT 0,
  filled_stock INT NOT NULL DEFAULT 0,
  empty_stock INT NOT NULL DEFAULT 0,
  min_stock INT NOT NULL DEFAULT 5,
  status ENUM('active', 'inactive') DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ============================================================
-- water_additions columns used in routes
-- ============================================================
SET @tablename = 'water_additions';

SET @columnname = 'purchase_type';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  "ALTER TABLE water_additions ADD COLUMN purchase_type ENUM('water', 'bottles') DEFAULT 'water'"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @columnname = 'water_bottle_item_id';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE water_additions ADD COLUMN water_bottle_item_id INT NULL'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @columnname = 'empty_bottles_returned';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE water_additions ADD COLUMN empty_bottles_returned INT DEFAULT 0'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- ============================================================
-- water_jerrycans columns used in routes
-- ============================================================
SET @tablename = 'water_jerrycans';

SET @columnname = 'reference_id';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE water_jerrycans ADD COLUMN reference_id INT NULL'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- ============================================================
-- water_sales columns used in routes
-- ============================================================
SET @tablename = 'water_sales';

SET @columnname = 'purchase_id';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE water_sales ADD COLUMN purchase_id INT NULL'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @columnname = 'bottle_price_sold';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE water_sales ADD COLUMN bottle_price_sold DECIMAL(10, 2) DEFAULT 0'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @columnname = 'water_bottle_item_id';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE water_sales ADD COLUMN water_bottle_item_id INT NULL'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

SET @columnname = 'status';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  "ALTER TABLE water_sales ADD COLUMN status VARCHAR(20) DEFAULT 'Paid'"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- sale_type: normalize legacy values then enforce the enum used by routes
UPDATE water_sales
SET sale_type = CASE
  WHEN sale_type = 'water_and_bottle' THEN 'water_only'
  WHEN sale_type = 'empty_bottle' THEN 'bottle_only'
  ELSE sale_type
END
WHERE sale_type IS NOT NULL;

SET @columnname = 'sale_type';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  "ALTER TABLE water_sales MODIFY COLUMN sale_type ENUM('water_only','water_with_exchange','bottle_only') NULL",
  "ALTER TABLE water_sales ADD COLUMN sale_type ENUM('water_only','water_with_exchange','bottle_only') NULL"
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;
