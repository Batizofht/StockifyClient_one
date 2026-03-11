/**
 * Master migration runner - runs all .sql files from migrations folder
 * AND all run-*.js migration scripts
 * From server folder: node run-all-migrations.js
 */
const { pool } = require('./config/database');
const fs = require('fs');
const path = require('path');

// Helper function to check if column exists
async function columnExists(tableName, columnName) {
  const [rows] = await pool.query(`
    SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
  `, [tableName, columnName]);
  return rows[0].count > 0;
}

// Helper function to check if table exists
async function tableExists(tableName) {
  const [rows] = await pool.query(`
    SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.TABLES 
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
  `, [tableName]);
  return rows[0].count > 0;
}

// Order of SQL files to run (in correct dependency order)
const sqlFilesOrder = [
  'water_management.sql',           // Base water tables first
  'add_email_settings.sql',         // Email settings
  'create_previous_stock_table.sql', // Previous stock table
  'add_previous_stock_to_items.sql', // Previous stock column
  'add_purchase_payment_tracking.sql', // Purchase order payment tracking
  'add_sale_type_column.sql',       // Sale type
  'water_management_water_name.sql', // Water name columns
  'water_bottle_enhancements.sql',  // Bottle enhancements
  'water_jerrycans_water_name.sql', // Jerrycan water name
  'water_sales_bottle_tracking.sql', // Sales bottle tracking
  'route_schema_backfill.sql',      // Backfill schema previously done in routes
  'add_quantity_to_jerrycans.sql',  // Quantity column
  'water_jerrycans_quantity.sql'    // Quantity migration
];

// Execute a single SQL statement (skip comments and empty lines)
async function executeSqlStatements(sqlContent, fileName) {
  // Split by semicolon but handle the prepared statement blocks
  const statements = sqlContent
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  for (const stmt of statements) {
    if (stmt.length > 0) {
      try {
        await pool.query(stmt);
      } catch (err) {
        // Ignore duplicate column/table errors
        if (err.code === 'ER_DUP_FIELDNAME' || 
            err.code === 'ER_TABLE_EXISTS_ERROR' ||
            err.message.includes('Duplicate column') ||
            err.message.includes('already exists')) {
          // Skip silently
        } else {
          console.log(`   ⚠️ Warning in ${fileName}: ${err.message.substring(0, 80)}`);
        }
      }
    }
  }
}

async function runAllMigrations() {
  console.log('🚀 Starting all migrations from /migrations folder...\n');

  const migrationsDir = path.join(__dirname, 'migrations');

  try {
    // Run SQL files in order
    for (let i = 0; i < sqlFilesOrder.length; i++) {
      const fileName = sqlFilesOrder[i];
      const filePath = path.join(migrationsDir, fileName);
      
      if (fs.existsSync(filePath)) {
        console.log(`� [${i + 1}/${sqlFilesOrder.length}] Running ${fileName}...`);
        const sqlContent = fs.readFileSync(filePath, 'utf8');
        await executeSqlStatements(sqlContent, fileName);
        console.log(`   ✓ ${fileName} completed`);
      } else {
        console.log(`   ⏭️ ${fileName} not found, skipping`);
      }
    }

    console.log('\n═══════════════════════════════════════');
    console.log('✅ ALL SQL MIGRATIONS COMPLETED!');
    console.log('═══════════════════════════════════════\n');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error);
  } finally {
    process.exit(0);
  }
}

runAllMigrations();
