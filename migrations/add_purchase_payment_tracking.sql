-- Add payment tracking columns to purchase_orders table
ALTER TABLE purchase_orders 
ADD COLUMN payment_status ENUM('paid_in_full', 'on_credit') DEFAULT 'paid_in_full' AFTER status,
ADD COLUMN amount_paid DECIMAL(10, 2) DEFAULT 0 AFTER payment_status,
ADD COLUMN debt_id INT NULL AFTER amount_paid,
ADD FOREIGN KEY (debt_id) REFERENCES debts(id) ON DELETE SET NULL;

-- Add index for better query performance
CREATE INDEX idx_payment_status ON purchase_orders(payment_status);
CREATE INDEX idx_debt_id ON purchase_orders(debt_id);
