const { pool } = require('./config/database');

async function columnExists(tableName, columnName) {
  const [rows] = await pool.query(`
    SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
  `, [tableName, columnName]);
  return rows[0].count > 0;
}

async function runMigration() {
  try {
    console.log('🔄 Running purchase payment tracking migration...');
    
    // Add payment_status column
    if (!(await columnExists('purchase_orders', 'payment_status'))) {
      await pool.query(`
        ALTER TABLE purchase_orders 
        ADD COLUMN payment_status ENUM('paid_in_full', 'on_credit') DEFAULT 'paid_in_full' AFTER status
      `);
      console.log('✅ payment_status column added to purchase_orders table');
    } else {
      console.log('⏭️ payment_status column already exists');
    }
    
    // Add amount_paid column
    if (!(await columnExists('purchase_orders', 'amount_paid'))) {
      await pool.query(`
        ALTER TABLE purchase_orders 
        ADD COLUMN amount_paid DECIMAL(10, 2) DEFAULT 0 AFTER payment_status
      `);
      console.log('✅ amount_paid column added to purchase_orders table');
    } else {
      console.log('⏭️ amount_paid column already exists');
    }
    
    // Add debt_id column
    if (!(await columnExists('purchase_orders', 'debt_id'))) {
      await pool.query(`
        ALTER TABLE purchase_orders 
        ADD COLUMN debt_id INT NULL AFTER amount_paid
      `);
      console.log('✅ debt_id column added to purchase_orders table');
      
      // Add foreign key constraint
      await pool.query(`
        ALTER TABLE purchase_orders 
        ADD CONSTRAINT fk_purchase_debt 
        FOREIGN KEY (debt_id) REFERENCES debts(id) ON DELETE SET NULL
      `);
      console.log('✅ Foreign key constraint added');
    } else {
      console.log('⏭️ debt_id column already exists');
    }
    
    // Add indexes for better performance
    try {
      await pool.query(`CREATE INDEX idx_payment_status ON purchase_orders(payment_status)`);
      console.log('✅ Index on payment_status created');
    } catch (err) {
      if (err.code === 'ER_DUP_KEYNAME') {
        console.log('⏭️ Index on payment_status already exists');
      } else {
        throw err;
      }
    }
    
    try {
      await pool.query(`CREATE INDEX idx_debt_id ON purchase_orders(debt_id)`);
      console.log('✅ Index on debt_id created');
    } catch (err) {
      if (err.code === 'ER_DUP_KEYNAME') {
        console.log('⏭️ Index on debt_id already exists');
      } else {
        throw err;
      }
    }
    
    console.log('✅ Migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error);
  } finally {
    process.exit(0);
  }
}

runMigration();
