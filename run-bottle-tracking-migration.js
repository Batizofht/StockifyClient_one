const { pool } = require('./config/database');

// Helper function to check if column exists
async function columnExists(tableName, columnName) {
  const [rows] = await pool.query(`
    SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
  `, [tableName, columnName]);
  return rows[0].count > 0;
}

async function runMigrations() {
  try {
    console.log('Running water management bottle tracking migrations...');

    // water_jerrycans columns
    const jerrycanColumns = [
      { name: 'water_name', sql: 'ALTER TABLE water_jerrycans ADD COLUMN water_name VARCHAR(255)' }
    ];

    for (const col of jerrycanColumns) {
      if (!(await columnExists('water_jerrycans', col.name))) {
        await pool.query(col.sql);
        console.log(`✓ water_jerrycans.${col.name} added`);
      } else {
        console.log(`⏭️ water_jerrycans.${col.name} already exists`);
      }
    }

    // water_sales columns
    const salesColumns = [
      { name: 'water_name', sql: 'ALTER TABLE water_sales ADD COLUMN water_name VARCHAR(255)' },
      { name: 'capacity', sql: 'ALTER TABLE water_sales ADD COLUMN capacity INT DEFAULT 20' },
      { name: 'customer_brings_bottle', sql: 'ALTER TABLE water_sales ADD COLUMN customer_brings_bottle BOOLEAN DEFAULT FALSE' },
      { name: 'includes_bottle', sql: 'ALTER TABLE water_sales ADD COLUMN includes_bottle BOOLEAN DEFAULT TRUE' },
      { name: 'is_bottle_sale', sql: 'ALTER TABLE water_sales ADD COLUMN is_bottle_sale BOOLEAN DEFAULT FALSE' }
    ];

    for (const col of salesColumns) {
      if (!(await columnExists('water_sales', col.name))) {
        await pool.query(col.sql);
        console.log(`✓ water_sales.${col.name} added`);
      } else {
        console.log(`⏭️ water_sales.${col.name} already exists`);
      }
    }

    console.log('All migrations completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  } finally {
    process.exit(0);
  }
}

if (require.main === module) {
  runMigrations().catch(console.error);
}

module.exports = { runMigrations };
