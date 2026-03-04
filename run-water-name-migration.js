/**
 * Run once to add water_name and related columns for product-based water selling.
 * From server folder: node run-water-name-migration.js
 */
const { pool } = require('./config/database');

// Helper function to check if column exists
async function columnExists(tableName, columnName) {
  const [rows] = await pool.query(`
    SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
  `, [tableName, columnName]);
  return rows[0].count > 0;
}

const columnSteps = [
  { table: 'water_jerrycans', column: 'water_name', sql: "ALTER TABLE water_jerrycans ADD COLUMN water_name VARCHAR(100) DEFAULT 'Water'" },
  { table: 'water_additions', column: 'water_name', sql: "ALTER TABLE water_additions ADD COLUMN water_name VARCHAR(100) DEFAULT 'Water'" },
  { table: 'water_additions', column: 'status', sql: "ALTER TABLE water_additions ADD COLUMN status VARCHAR(20) DEFAULT 'filled'" },
  { table: 'water_sales', column: 'water_name', sql: "ALTER TABLE water_sales ADD COLUMN water_name VARCHAR(100) DEFAULT 'Water'" },
  { table: 'water_sales', column: 'capacity', sql: 'ALTER TABLE water_sales ADD COLUMN capacity INT DEFAULT 20' }
];

const backfillSteps = [
  { name: 'backfill jerrycans', sql: "UPDATE water_jerrycans SET water_name = COALESCE(water_name, 'Water') WHERE water_name IS NULL OR water_name = ''" },
  { name: 'backfill additions', sql: "UPDATE water_additions SET water_name = COALESCE(water_name, 'Water'), status = COALESCE(status, 'filled') WHERE water_name IS NULL OR water_name = ''" },
  { name: 'backfill sales', sql: "UPDATE water_sales SET water_name = COALESCE(water_name, 'Water'), capacity = COALESCE(capacity, 20) WHERE water_name IS NULL OR water_name = ''" }
];

async function run() {
  console.log('🔄 Running water name migration...');
  
  // Add columns
  for (const step of columnSteps) {
    try {
      if (!(await columnExists(step.table, step.column))) {
        await pool.query(step.sql);
        console.log(`✓ ${step.table}.${step.column} added`);
      } else {
        console.log(`⏭️ ${step.table}.${step.column} already exists`);
      }
    } catch (err) {
      console.error(`❌ Failed: ${step.table}.${step.column}`, err.message);
    }
  }
  
  // Run backfill updates
  for (const step of backfillSteps) {
    try {
      await pool.query(step.sql);
      console.log(`✓ ${step.name}`);
    } catch (err) {
      console.error(`❌ Failed: ${step.name}`, err.message);
    }
  }
  
  console.log('✅ Water name migration completed!');
  process.exit(0);
}

run();
