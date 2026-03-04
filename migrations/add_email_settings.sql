-- Create email settings table
CREATE TABLE IF NOT EXISTS email_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  smtp_host VARCHAR(255) NOT NULL,
  smtp_port INT NOT NULL DEFAULT 587,
  smtp_secure BOOLEAN NOT NULL DEFAULT FALSE,
  smtp_user VARCHAR(255) NOT NULL,
  smtp_password TEXT NOT NULL,
  notification_email VARCHAR(255) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- MySQL compatible syntax (no IF NOT EXISTS for columns)
SET @dbname = DATABASE();

-- Add notification_email to users table
SET @tablename = 'users';
SET @columnname = 'notification_email';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE users ADD COLUMN notification_email VARCHAR(255) NULL'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;

-- Add notification_email to notification_settings table
SET @tablename = 'notification_settings';
SET @columnname = 'notification_email';
SET @preparedStatement = (SELECT IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS 
   WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = @tablename AND COLUMN_NAME = @columnname) > 0,
  'SELECT 1',
  'ALTER TABLE notification_settings ADD COLUMN notification_email VARCHAR(255) NULL'
));
PREPARE alterIfNotExists FROM @preparedStatement;
EXECUTE alterIfNotExists;
DEALLOCATE PREPARE alterIfNotExists;
