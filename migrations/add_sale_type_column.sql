-- Migration: Add sale_type column to sales table

-- Add sale_type column if it doesn't exist
ALTER TABLE sales ADD COLUMN IF NOT EXISTS sale_type ENUM('retail', 'wholesale') DEFAULT 'retail' AFTER status;

-- Alternative for MySQL versions that don't support IF NOT EXISTS:
-- First check if column exists, then run:
-- ALTER TABLE sales ADD COLUMN sale_type ENUM('retail', 'wholesale') DEFAULT 'retail' AFTER status;
