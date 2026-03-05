const { pool } = require('./config/database');

async function cleanupNegativeDebts() {
  try {
    console.log('🔍 Checking for debts with negative balances...');
    
    // Find debts where total installments exceed debt amount
    const [debtsWithNegativeBalance] = await pool.query(`
      SELECT 
        d.id,
        d.person,
        d.amount as debt_amount,
        d.description,
        COALESCE(SUM(di.amount), 0) as total_paid,
        (d.amount - COALESCE(SUM(di.amount), 0)) as balance
      FROM debts d
      LEFT JOIN debt_installments di ON d.id = di.debt_id
      GROUP BY d.id
      HAVING balance < 0
    `);

    if (debtsWithNegativeBalance.length === 0) {
      console.log('✅ No debts with negative balances found.');
      return;
    }

    console.log(`\n⚠️  Found ${debtsWithNegativeBalance.length} debt(s) with negative balance:\n`);
    
    debtsWithNegativeBalance.forEach((debt, index) => {
      console.log(`${index + 1}. ID: ${debt.id}`);
      console.log(`   Person: ${debt.person}`);
      console.log(`   Description: ${debt.description}`);
      console.log(`   Debt Amount: ${debt.debt_amount}`);
      console.log(`   Total Paid: ${debt.total_paid}`);
      console.log(`   Balance: ${debt.balance} (NEGATIVE)\n`);
    });

    console.log('🗑️  Deleting debts with negative balances...');
    
    for (const debt of debtsWithNegativeBalance) {
      // Delete installments first
      await pool.query('DELETE FROM debt_installments WHERE debt_id = ?', [debt.id]);
      console.log(`   ✓ Deleted installments for debt ID ${debt.id}`);
      
      // Delete debt
      await pool.query('DELETE FROM debts WHERE id = ?', [debt.id]);
      console.log(`   ✓ Deleted debt ID ${debt.id} (${debt.person})`);
      
      // Update purchase order to remove debt_id reference
      await pool.query('UPDATE purchase_orders SET debt_id = NULL WHERE debt_id = ?', [debt.id]);
      console.log(`   ✓ Updated purchase orders to remove debt reference\n`);
    }

    console.log('✅ Cleanup completed successfully!');
    console.log(`   Removed ${debtsWithNegativeBalance.length} debt(s) with negative balances.`);
    
  } catch (error) {
    console.error('❌ Error during cleanup:', error);
  } finally {
    await pool.end();
  }
}

// Run the cleanup
cleanupNegativeDebts();
