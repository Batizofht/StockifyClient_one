const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { logActivity } = require('../utils/activityLogger');

// Auto-migrate: Add required columns and consolidate to quantity-based
(async () => {
  try {
    await pool.query(`ALTER TABLE water_additions ADD COLUMN IF NOT EXISTS bottle_price DECIMAL(10, 2) DEFAULT 0`);
    await pool.query(`ALTER TABLE water_additions ADD COLUMN IF NOT EXISTS status ENUM('filled', 'empty') DEFAULT 'filled'`);
    
    // Add quantity column to water_jerrycans if it doesn't exist
    await pool.query(`ALTER TABLE water_jerrycans ADD COLUMN IF NOT EXISTS quantity INT DEFAULT 1`);
    
    // Add purchase_id to water_sales for tracking
    await pool.query(`ALTER TABLE water_sales ADD COLUMN IF NOT EXISTS purchase_id INT NULL`);
    
    // Add reference_id to water_jerrycans for linking to purchases
    await pool.query(`ALTER TABLE water_jerrycans ADD COLUMN IF NOT EXISTS reference_id INT NULL`);
    
    // Add water_price and bottle_price_sold columns to water_sales for accurate profit tracking
    await pool.query(`ALTER TABLE water_sales ADD COLUMN IF NOT EXISTS water_price DECIMAL(10, 2) DEFAULT 0`);
    await pool.query(`ALTER TABLE water_sales ADD COLUMN IF NOT EXISTS bottle_price_sold DECIMAL(10, 2) DEFAULT 0`);
    
    // Check if we need to consolidate (if there are many rows with quantity=1)
    const [checkRows] = await pool.query(`SELECT COUNT(*) as cnt FROM water_jerrycans WHERE quantity = 1`);
    const rowCount = checkRows[0]?.cnt || 0;
    
    if (rowCount > 50) {
      console.log('🔄 Consolidating water_jerrycans rows...');
      // Consolidate rows by water_name, capacity, status
      await pool.query(`
        CREATE TEMPORARY TABLE IF NOT EXISTS temp_consolidated AS
        SELECT 
          COALESCE(water_name, 'Water') as water_name,
          capacity,
          status,
          MAX(selling_price) as selling_price,
          MAX(COALESCE(bottle_price, 0)) as bottle_price,
          MAX(COALESCE(bottle_health, 'good')) as bottle_health,
          SUM(COALESCE(quantity, 1)) as quantity,
          MAX(created_at) as created_at
        FROM water_jerrycans
        GROUP BY water_name, capacity, status
      `);
      
      await pool.query(`DELETE FROM water_jerrycans`);
      
      await pool.query(`
        INSERT INTO water_jerrycans (water_name, capacity, status, selling_price, bottle_price, bottle_health, quantity, serial_number, created_at)
        SELECT 
          water_name, capacity, status, selling_price, bottle_price, bottle_health, quantity,
          CONCAT('STOCK-', REPLACE(water_name, ' ', '-'), '-', capacity, 'L-', status),
          created_at
        FROM temp_consolidated
      `);
      
      await pool.query(`DROP TEMPORARY TABLE IF EXISTS temp_consolidated`);
      console.log('✅ Consolidated water_jerrycans rows');
    }
    
    console.log('✅ Water management tables ready');
  } catch (err) {
    console.log('Water management migration:', err.message);
  }
})();

// GET available water stats
router.get('/available-water', async (req, res) => {
  try {
    const [filledResult] = await pool.query(
      'SELECT SUM(COALESCE(quantity, 1)) as count, SUM(capacity * COALESCE(quantity, 1)) as totalLiters FROM water_jerrycans WHERE status = "filled"'
    );
    
    const filledCount = filledResult[0].count || 0;
    const availableLiters = filledResult[0].totalLiters || 0;
    
    res.json({
      success: true,
      data: {
        totalLiters: availableLiters,
        totalJerrycans: filledCount,
        filledJerrycans: filledCount
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET available products (water_name + capacity with filled stock) for selling
router.get('/available-products', async (req, res) => {
  try {
    // Get available jerrycans grouped by water_name and capacity, include MAX bottle_price
    const [rows] = await pool.query(`
      SELECT COALESCE(j.water_name, 'Water') as water_name, 
             j.capacity, 
             MAX(j.selling_price) as selling_price, 
             MAX(COALESCE(j.bottle_price, 0)) as bottle_price,
             SUM(COALESCE(j.quantity, 1)) as available
      FROM water_jerrycans j
      WHERE j.status = 'filled'
      GROUP BY j.water_name, j.capacity
      HAVING available > 0
      ORDER BY j.water_name, j.capacity
    `);

    const products = rows.map((r) => ({
      water_name: r.water_name,
      capacity: r.capacity || 20,
      selling_price: parseFloat(r.selling_price) || 0,
      bottle_price: parseFloat(r.bottle_price) || 0,
      available: r.available,
      label: `${(r.water_name || 'Water').toUpperCase()} ${r.capacity || 20} LITRES`
    }));
    
    res.json({ success: true, data: products });
  } catch (error) {
    console.error('Error in available-products:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET water sales with filtering
router.get('/sales', async (req, res) => {
  try {
    const { period, start_date, end_date } = req.query;
    let dateFilter = '';
    
    if (period === 'today') {
      dateFilter = 'DATE(s.created_at) = CURDATE()';
    } else if (period === 'yesterday') {
      dateFilter = 'DATE(s.created_at) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)';
    } else if (period === 'this_week') {
      dateFilter = 'DATE(s.created_at) >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)';
    } else if (period === 'this_month') {
      dateFilter = 'MONTH(s.created_at) = MONTH(CURDATE()) AND YEAR(s.created_at) = YEAR(CURDATE())';
    } else if (start_date && end_date) {
      dateFilter = 'DATE(s.created_at) BETWEEN ? AND ?';
    }
    
    let query = `
      SELECT s.*, 
             a.supplier_name as purchase_supplier,
             a.buying_price_per_jerrycan as purchase_water_cost,
             a.bottle_price as purchase_bottle_cost,
             a.date as purchase_date
      FROM water_sales s
      LEFT JOIN water_additions a ON s.purchase_id = a.id
    `;
    let params = [];
    
    if (dateFilter) {
      query += ' WHERE ' + dateFilter;
      if (start_date && end_date) {
        params = [start_date, end_date];
      }
    }
    
    query += ' ORDER BY s.created_at DESC';
    
    const [sales] = await pool.query(query, params);
    
    // Calculate summary using stored profit values
    const totalLiters = sales.reduce((sum, sale) => sum + (sale.jerrycans_sold * (sale.capacity || 20)), 0);
    const totalRevenue = sales.reduce((sum, sale) => sum + parseFloat(sale.total_amount || 0), 0);
    const totalProfit = sales.reduce((sum, sale) => sum + parseFloat(sale.profit || 0), 0);
    const salesCount = sales.length;

    const summary = {
      totalLiters,
      totalRevenue,
      totalProfit,
      salesCount
    };
    
    res.json({
      success: true,
      data: {
        sales,
        summary
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// CREATE water sale (with optional water_name + capacity for product-based selling)
router.post('/sales', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const { jerrycans_sold, price_per_jerrycan, customer_name, payment_method, notes, water_name, capacity, customer_brings_bottle, includes_bottle, water_price, bottle_price } = req.body;

    if (!jerrycans_sold || !price_per_jerrycan) {
      return res.status(400).json({ error: 'Jerrycans sold and price per jerrycan are required' });
    }

    const total_amount = jerrycans_sold * price_per_jerrycan;
    const custName = customer_name && String(customer_name).trim() ? String(customer_name).trim() : 'Client';
    const wName = water_name && String(water_name).trim() ? String(water_name).trim() : null;
    const cap = capacity != null ? parseInt(capacity, 10) : null;
    const customerBringsBottle = customer_brings_bottle === true;
    const includesBottle = includes_bottle === true;
    
    // Store the water and bottle prices from the sale
    const saleWaterPrice = parseFloat(water_price) || 0;
    const saleBottlePrice = parseFloat(bottle_price) || 0;

    // Find filled stock for this product (quantity-based)
    const [stockRows] = await pool.query(
      'SELECT id, COALESCE(quantity, 1) as quantity, reference_id FROM water_jerrycans WHERE status = ? AND water_name = ? AND capacity = ? LIMIT 1',
      ['filled', wName || 'Water', cap || 20]
    );
    
    if (stockRows.length === 0 || stockRows[0].quantity < jerrycans_sold) {
      const available = stockRows.length > 0 ? stockRows[0].quantity : 0;
      return res.status(400).json({ error: `Amacupa ahari ni ${available} gusa` });
    }

    const stockId = stockRows[0].id;
    const currentQty = stockRows[0].quantity;
    const purchaseId = stockRows[0].reference_id;
    
    // Get purchase costs to calculate profit
    let buyingPricePerJerrycan = 0;
    let purchaseBottlePrice = 0;
    
    if (purchaseId) {
      const [purchaseRows] = await pool.query(
        'SELECT buying_price_per_jerrycan, bottle_price FROM water_additions WHERE id = ?',
        [purchaseId]
      );
      if (purchaseRows.length > 0) {
        buyingPricePerJerrycan = parseFloat(purchaseRows[0].buying_price_per_jerrycan) || 0;
        purchaseBottlePrice = parseFloat(purchaseRows[0].bottle_price) || 0;
      }
    }
    
    // Calculate profit based on sale type
    let profit = 0;
    if (customerBringsBottle) {
      // Water only (swap) - customer brings empty bottle, gets filled one
      // Revenue = water price, Cost = water buying cost
      profit = (saleWaterPrice - buyingPricePerJerrycan) * jerrycans_sold;
    } else if (includesBottle) {
      // Water + Bottle - new customer takes both
      // Revenue = water price + bottle price, Cost = water buying cost + bottle cost
      profit = ((saleWaterPrice + saleBottlePrice) - (buyingPricePerJerrycan + purchaseBottlePrice)) * jerrycans_sold;
    } else {
      // Bottle only (rare case)
      profit = (saleBottlePrice - purchaseBottlePrice) * jerrycans_sold;
    }

    // Create sale record with purchase_id and calculated profit
    const [result] = await pool.query(
      'INSERT INTO water_sales (water_name, capacity, jerrycans_sold, price_per_jerrycan, total_amount, profit, customer_name, payment_method, notes, customer_brings_bottle, includes_bottle, purchase_id, water_price, bottle_price_sold) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [wName || 'Water', cap || 20, jerrycans_sold, price_per_jerrycan, total_amount, profit, custName, payment_method || 'cash', notes || '', customerBringsBottle, includesBottle, purchaseId, saleWaterPrice, saleBottlePrice]
    );

    // Handle bottle inventory based on whether customer takes bottle or brings their own
    if (includesBottle && !customerBringsBottle) {
      // Customer takes the bottle (buys it) - reduce filled quantity
      const newQty = currentQty - jerrycans_sold;
      if (newQty <= 0) {
        await pool.query('DELETE FROM water_jerrycans WHERE id = ?', [stockId]);
      } else {
        await pool.query('UPDATE water_jerrycans SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newQty, stockId]);
      }
    } else {
      // Customer brings their own bottle (swaps) - reduce filled, add to empty
      const newFilledQty = currentQty - jerrycans_sold;
      if (newFilledQty <= 0) {
        await pool.query('DELETE FROM water_jerrycans WHERE id = ?', [stockId]);
      } else {
        await pool.query('UPDATE water_jerrycans SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newFilledQty, stockId]);
      }
      
      // Add to empty stock
      const [emptyRows] = await pool.query(
        'SELECT id, quantity FROM water_jerrycans WHERE status = ? AND water_name = ? AND capacity = ? LIMIT 1',
        ['empty', wName || 'Water', cap || 20]
      );
      
      if (emptyRows.length > 0) {
        await pool.query('UPDATE water_jerrycans SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [jerrycans_sold, emptyRows[0].id]);
      } else {
        await pool.query(
          'INSERT INTO water_jerrycans (water_name, capacity, status, serial_number, selling_price, quantity, created_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
          [wName || 'Water', cap || 20, 'empty', `STOCK-${wName || 'Water'}-${cap || 20}L-empty`, 0, jerrycans_sold]
        );
      }
    }

    if (userId) {
      await logActivity({
        userId: parseInt(userId),
        actionType: 'create',
        entityType: 'water_sale',
        entityId: result.insertId,
        entityName: `Water Sale #${result.insertId}`,
        description: `yagurishije amazi ya ${jerrycans_sold} jerrycans ${customerBringsBottle ? "(umukiriya azanya icupa)" : "(aratwara icupa)"}`,
        metadata: { jerrycans_sold, total_amount, profit, customerBringsBottle, includesBottle, purchase_id: purchaseId }
      });
    }

    res.json({
      success: true,
      data: {
        id: result.insertId,
        water_name: wName || 'Water',
        capacity: cap || 20,
        jerrycans_sold,
        price_per_jerrycan,
        total_amount,
        profit,
        water_price: saleWaterPrice,
        bottle_price_sold: saleBottlePrice,
        customer_name: custName,
        payment_method: payment_method || 'cash',
        notes: notes || '',
        customer_brings_bottle: customerBringsBottle,
        includes_bottle: includesBottle,
        purchase_id: purchaseId
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// UPDATE water sale - FIXED to update water jerrycans
router.put('/sales/:id', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const { id } = req.params;
    const { jerrycans_sold, price_per_jerrycan, customer_name, payment_method, notes, water_name, capacity } = req.body;
    
    if (!jerrycans_sold || !price_per_jerrycan) {
      return res.status(400).json({ error: 'Jerrycans sold and price per jerrycan are required' });
    }
    
    // Get the original sale details first
    const [originalSaleRows] = await pool.query(
      'SELECT * FROM water_sales WHERE id = ?',
      [id]
    );
    
    if (originalSaleRows.length === 0) {
      return res.status(404).json({ error: 'Sale not found' });
    }
    
    const originalSale = originalSaleRows[0];
    const {
      jerrycans_sold: originalQty,
      water_name: originalWaterName,
      capacity: originalCapacity,
      includes_bottle: originalIncludesBottle,
      customer_brings_bottle: originalCustomerBringsBottle,
      purchase_id: originalPurchaseId
    } = originalSale;
    
    // Calculate the difference
    const quantityDiff = jerrycans_sold - originalQty;
    
    // If quantity changed, update stock
    if (quantityDiff !== 0) {
      const wName = water_name || originalWaterName;
      const cap = capacity || originalCapacity;
      const includesBottle = originalIncludesBottle;
      const customerBringsBottle = originalCustomerBringsBottle;
      
      if (quantityDiff > 0) {
        // Selling MORE jerrycans - check if we have enough stock
        const [stockRows] = await pool.query(
          'SELECT id, quantity FROM water_jerrycans WHERE status = "filled" AND water_name = ? AND capacity = ? LIMIT 1',
          [wName, cap]
        );
        
        if (stockRows.length === 0 || stockRows[0].quantity < quantityDiff) {
          const available = stockRows.length > 0 ? stockRows[0].quantity : 0;
          return res.status(400).json({ 
            error: `Cannot update sale. Amacupa ahari ni ${available} gusa, ariko urashaka kongeraho ${quantityDiff}` 
          });
        }
        
        // Reduce stock
        const stockId = stockRows[0].id;
        const newQty = stockRows[0].quantity - quantityDiff;
        
        if (newQty <= 0) {
          await pool.query('DELETE FROM water_jerrycans WHERE id = ?', [stockId]);
        } else {
          await pool.query('UPDATE water_jerrycans SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newQty, stockId]);
        }
        
        // Handle empty bottles if customer brings their own
        if (!includesBottle || customerBringsBottle) {
          const [emptyRows] = await pool.query(
            'SELECT id, quantity FROM water_jerrycans WHERE status = "empty" AND water_name = ? AND capacity = ? LIMIT 1',
            [wName, cap]
          );
          
          if (emptyRows.length > 0) {
            await pool.query('UPDATE water_jerrycans SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [quantityDiff, emptyRows[0].id]);
          } else {
            await pool.query(
              'INSERT INTO water_jerrycans (water_name, capacity, status, quantity, created_at) VALUES (?, ?, "empty", ?, CURRENT_TIMESTAMP)',
              [wName, cap, quantityDiff]
            );
          }
        }
        
      } else {
        // Selling FEWER jerrycans - add stock back
        const quantityToRestore = Math.abs(quantityDiff);
        
        // Add to filled stock
        const [filledRows] = await pool.query(
          'SELECT id, quantity FROM water_jerrycans WHERE status = "filled" AND water_name = ? AND capacity = ? LIMIT 1',
          [wName, cap]
        );
        
        if (filledRows.length > 0) {
          await pool.query(
            'UPDATE water_jerrycans SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [quantityToRestore, filledRows[0].id]
          );
        } else {
          await pool.query(
            'INSERT INTO water_jerrycans (water_name, capacity, status, quantity, created_at) VALUES (?, ?, "filled", ?, CURRENT_TIMESTAMP)',
            [wName, cap, quantityToRestore]
          );
        }
        
        // If customer was bringing their own bottle, remove from empty stock
        if (!includesBottle || customerBringsBottle) {
          const [emptyRows] = await pool.query(
            'SELECT id, quantity FROM water_jerrycans WHERE status = "empty" AND water_name = ? AND capacity = ? LIMIT 1',
            [wName, cap]
          );
          
          if (emptyRows.length > 0) {
            const currentEmptyQty = emptyRows[0].quantity;
            if (currentEmptyQty <= quantityToRestore) {
              await pool.query('DELETE FROM water_jerrycans WHERE id = ?', [emptyRows[0].id]);
            } else {
              await pool.query(
                'UPDATE water_jerrycans SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [quantityToRestore, emptyRows[0].id]
              );
            }
          }
        }
      }
      
      // Update purchase record if purchase_id exists
      if (originalPurchaseId && quantityDiff !== 0) {
        await pool.query(
          'UPDATE water_additions SET jerrycans_added = jerrycans_added - ?, total_liters = total_liters - (? * ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [quantityDiff, quantityDiff, cap, originalPurchaseId]
        );
      }
    }
    
    // Update the sale record
    const total_amount = jerrycans_sold * price_per_jerrycan;
    
    // Get the original water_price and bottle_price_sold to recalculate profit
    const saleWaterPrice = parseFloat(originalSale.water_price) || 0;
    const saleBottlePrice = parseFloat(originalSale.bottle_price_sold) || 0;
    
    // Get purchase costs to recalculate profit
    let buyingPricePerJerrycan = 0;
    let purchaseBottlePrice = 0;
    
    if (originalPurchaseId) {
      const [purchaseRows] = await pool.query(
        'SELECT buying_price_per_jerrycan, bottle_price FROM water_additions WHERE id = ?',
        [originalPurchaseId]
      );
      if (purchaseRows.length > 0) {
        buyingPricePerJerrycan = parseFloat(purchaseRows[0].buying_price_per_jerrycan) || 0;
        purchaseBottlePrice = parseFloat(purchaseRows[0].bottle_price) || 0;
      }
    }
    
    // Recalculate profit based on sale type
    let profit = 0;
    if (originalCustomerBringsBottle) {
      // Water only (swap)
      profit = (saleWaterPrice - buyingPricePerJerrycan) * jerrycans_sold;
    } else if (originalIncludesBottle) {
      // Water + Bottle
      profit = ((saleWaterPrice + saleBottlePrice) - (buyingPricePerJerrycan + purchaseBottlePrice)) * jerrycans_sold;
    } else {
      // Bottle only
      profit = (saleBottlePrice - purchaseBottlePrice) * jerrycans_sold;
    }
    
    await pool.query(
      'UPDATE water_sales SET jerrycans_sold = ?, price_per_jerrycan = ?, total_amount = ?, profit = ?, customer_name = ?, payment_method = ?, notes = ?, water_name = ?, capacity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [
        jerrycans_sold, 
        price_per_jerrycan, 
        total_amount, 
        profit, 
        customer_name || 'Walk-in Customer', 
        payment_method || 'cash', 
        notes || '',
        water_name || originalWaterName,
        capacity || originalCapacity,
        id
      ]
    );
    
    if (userId) {
      await logActivity({
        userId: parseInt(userId),
        actionType: 'update',
        entityType: 'water_sale',
        entityId: parseInt(id),
        entityName: `Water Sale #${id}`,
        description: `yahuje igurisha amazi #${id} (yakuyeho ${quantityDiff} jerrycans)`,
        metadata: { 
          jerrycans_sold, 
          total_amount, 
          profit,
          quantity_change: quantityDiff,
          purchase_id: originalPurchaseId
        }
      });
    }
    
    res.json({ 
      success: true, 
      message: 'Sale updated and stock adjusted',
      stock_adjusted: quantityDiff !== 0,
      quantity_change: quantityDiff
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE water sale - IMPROVED VERSION
router.delete('/sales/:id', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const { id } = req.params;
    
    // First, get the sale details
    const [saleRows] = await pool.query('SELECT * FROM water_sales WHERE id = ?', [id]);
    
    if (saleRows.length === 0) {
      return res.status(404).json({ error: 'Sale not found' });
    }
    
    const sale = saleRows[0];
    const { 
      water_name, 
      capacity, 
      jerrycans_sold, 
      purchase_id, 
      includes_bottle, 
      customer_brings_bottle 
    } = sale;
    
    // RESTORE WATER BACK TO STOCK based on transaction type
    if (includes_bottle && !customer_brings_bottle) {
      // Customer bought the bottle - restore to filled stock
      await restoreToStock(water_name, capacity, jerrycans_sold, 'filled');
    } else {
      // Customer brought their own bottle or it was a swap
      // Remove from empty stock (if exists)
      const [emptyRows] = await pool.query(
        'SELECT id, quantity FROM water_jerrycans WHERE water_name = ? AND capacity = ? AND status = "empty" LIMIT 1',
        [water_name, capacity]
      );
      
      if (emptyRows.length > 0) {
        const currentEmptyQty = emptyRows[0].quantity;
        if (currentEmptyQty <= jerrycans_sold) {
          await pool.query('DELETE FROM water_jerrycans WHERE id = ?', [emptyRows[0].id]);
        } else {
          await pool.query(
            'UPDATE water_jerrycans SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [jerrycans_sold, emptyRows[0].id]
          );
        }
      }
      
      // Add to filled stock
      await restoreToStock(water_name, capacity, jerrycans_sold, 'filled');
    }
    
    // UPDATE PURCHASE RECORD IF purchase_id EXISTS
    if (purchase_id) {
      await pool.query(
        'UPDATE water_additions SET jerrycans_added = jerrycans_added + ?, total_liters = total_liters + (? * ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [jerrycans_sold, jerrycans_sold, capacity, purchase_id]
      );
    }
    
    // Finally, delete the sale
    await pool.query('DELETE FROM water_sales WHERE id = ?', [id]);
    
    if (userId) {
      await logActivity({
        userId: parseInt(userId),
        actionType: 'delete',
        entityType: 'water_sale',
        entityId: parseInt(id),
        entityName: `Water Sale #${id}`,
        description: `yasibe igurisha amazi #${id} n'ongereye amazi mu stock`,
        metadata: {
          jerrycans_restored: jerrycans_sold,
          purchase_id: purchase_id || 'none'
        }
      });
    }
    
    res.json({ 
      success: true, 
      message: 'Sale deleted and water restored to stock',
      restored_jerrycans: jerrycans_sold,
      purchase_updated: purchase_id ? true : false
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper function to restore water to stock
async function restoreToStock(water_name, capacity, quantity, status) {
  const [stockRows] = await pool.query(
    'SELECT id, quantity FROM water_jerrycans WHERE water_name = ? AND capacity = ? AND status = ? LIMIT 1',
    [water_name, capacity, status]
  );
  
  if (stockRows.length > 0) {
    // Update existing stock
    await pool.query(
      'UPDATE water_jerrycans SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [quantity, stockRows[0].id]
    );
  } else {
    // Create new stock record
    await pool.query(
      'INSERT INTO water_jerrycans (water_name, capacity, status, quantity, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)',
      [water_name, capacity, status, quantity]
    );
  }
}
// GET water additions (with optional period, start_date, end_date)
router.get('/additions', async (req, res) => {
  try {
    const { period, start_date, end_date } = req.query;
    let dateFilter = '';
    let params = [];
    if (period === 'today') {
      dateFilter = 'DATE(created_at) = CURDATE()';
    } else if (period === 'yesterday') {
      dateFilter = 'DATE(created_at) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)';
    } else if (period === 'this_week') {
      dateFilter = 'DATE(created_at) >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)';
    } else if (period === 'this_month') {
      dateFilter = 'MONTH(created_at) = MONTH(CURDATE()) AND YEAR(created_at) = YEAR(CURDATE())';
    } else if (start_date && end_date) {
      dateFilter = 'DATE(created_at) BETWEEN ? AND ?';
      params = [start_date, end_date];
    }
    let query = 'SELECT id, water_name, status, jerrycans_added, liters_per_jerrycan, total_liters, buying_price_per_jerrycan, selling_price_per_jerrycan, COALESCE(bottle_price, 0) as bottle_price, total_buying_cost AS total_cost, total_selling_price, expected_profit, supplier_name, date, created_at, updated_at FROM water_additions';
    if (dateFilter) {
      query += ' WHERE ' + dateFilter;
    }
    query += ' ORDER BY created_at DESC';
    const [additions] = await pool.query(query, params);
    res.json({
      success: true,
      data: additions
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// CREATE water addition - FIXED VERSION
router.post('/additions', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const {
      water_name,
      status = 'filled',
      jerrycans_added,
      liters_per_jerrycan,
      buying_price_per_jerrycan = 0,
      selling_price_per_jerrycan = 0,
      bottle_price = 0,
      bottle_health = 'good',
      supplier_name,
      date
    } = req.body;

    if (!jerrycans_added || !liters_per_jerrycan) {
      return res.status(400).json({ error: 'Number of jerrycans and litres per jerrycan are required' });
    }
    
    const wName = (water_name && String(water_name).trim()) ? String(water_name).trim() : 'Water';
    const jerrycanStatus = status === 'empty' ? 'empty' : 'filled';
    const buying = parseFloat(buying_price_per_jerrycan) || 0;
    const selling = parseFloat(selling_price_per_jerrycan) || 0;
    const bottlePrice = parseFloat(bottle_price) || 0;
    const health = ['good', 'damaged', 'needs_repair'].includes(bottle_health) ? bottle_health : 'good';

    const total_liters = jerrycanStatus === 'filled' ? jerrycans_added * liters_per_jerrycan : 0;
    // For filled jerrycans: cost = water cost only (we swap bottles with distributor)
    // For empty bottles: cost = bottle cost only (we're buying new bottles)
    // bottle_price is stored separately for profit calculation when customer takes bottle
    const total_buying_cost = jerrycanStatus === 'filled' 
      ? jerrycans_added * buying  // Water cost only for filled
      : jerrycans_added * bottlePrice;  // Bottle cost only for empty
    const total_selling_price = jerrycans_added * selling;
    const expected_profit = total_selling_price - total_buying_cost;
    
    let dateVal = new Date().toISOString().split('T')[0];
    if (date) {
      const d = new Date(date);
      if (!isNaN(d.getTime())) {
        dateVal = d.toISOString().split('T')[0];
      }
    }

    // 1. FIRST create the purchase record
    const [result] = await pool.query(
      'INSERT INTO water_additions (water_name, status, jerrycans_added, liters_per_jerrycan, total_liters, buying_price_per_jerrycan, selling_price_per_jerrycan, bottle_price, total_buying_cost, total_selling_price, expected_profit, supplier_name, date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [wName, jerrycanStatus, jerrycans_added, liters_per_jerrycan, total_liters, buying, selling, bottlePrice, total_buying_cost, total_selling_price, expected_profit, supplier_name || '', dateVal]
    );

    const purchaseId = result.insertId;

    // 2. Handle bottle stock based on purchase type
    if (jerrycanStatus === 'filled') {
      // BUYING FILLED WATER: You give empty bottles to distributor, get filled ones back
      // First, reduce empty bottle stock (you gave them to distributor)
      const [emptyRows] = await pool.query(
        'SELECT id, quantity FROM water_jerrycans WHERE water_name = ? AND capacity = ? AND status = ? LIMIT 1',
        [wName, liters_per_jerrycan, 'empty']
      );
      
      if (emptyRows.length > 0) {
        const currentEmptyQty = emptyRows[0].quantity;
        const newEmptyQty = currentEmptyQty - jerrycans_added;
        
        if (newEmptyQty <= 0) {
          // Delete empty stock record if no more empty bottles
          await pool.query('DELETE FROM water_jerrycans WHERE id = ?', [emptyRows[0].id]);
        } else {
          // Reduce empty bottle quantity
          await pool.query(
            'UPDATE water_jerrycans SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [newEmptyQty, emptyRows[0].id]
          );
        }
      }
      // Note: If no empty bottles exist, we still add filled ones (maybe first purchase or new bottles)
    }

    // 3. Add to stock (filled or empty based on purchase type)
    const [existingRows] = await pool.query(
      'SELECT id, quantity FROM water_jerrycans WHERE water_name = ? AND capacity = ? AND status = ? AND reference_id IS NULL LIMIT 1',
      [wName, liters_per_jerrycan, jerrycanStatus]
    );
    
    if (existingRows.length > 0) {
      // Update existing record's quantity and prices
      await pool.query(
        'UPDATE water_jerrycans SET quantity = quantity + ?, selling_price = ?, bottle_price = ?, bottle_health = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [jerrycans_added, selling, bottlePrice, health, existingRows[0].id]
      );
    } else {
      // Insert new record with quantity AND reference_id
      await pool.query(
        'INSERT INTO water_jerrycans (water_name, capacity, status, serial_number, selling_price, bottle_price, bottle_health, quantity, reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
        [wName, liters_per_jerrycan, jerrycanStatus, `STOCK-${wName}-${liters_per_jerrycan}L-${jerrycanStatus}`, selling, bottlePrice, health, jerrycans_added, purchaseId]
      );
    }

    if (userId) {
      await logActivity({
        userId: parseInt(userId),
        actionType: 'create',
        entityType: 'water_addition',
        entityId: purchaseId,
        entityName: `Water Purchase #${purchaseId}`,
        description: `yaguze amazi ya ${jerrycans_added} jerrycans (${wName} ${liters_per_jerrycan}L)`,
        metadata: { jerrycans_added, total_liters, total_buying_cost, reference_id: purchaseId }
      });
    }

    res.json({
      success: true,
      data: {
        id: purchaseId,
        water_name: wName,
        status: jerrycanStatus,
        jerrycans_added,
        liters_per_jerrycan,
        total_liters,
        buying_price_per_jerrycan: buying,
        selling_price_per_jerrycan: selling,
        bottle_price: bottlePrice,
        bottle_health: health,
        total_buying_cost,
        total_selling_price,
        expected_profit,
        supplier_name: supplier_name || '',
        date: dateVal
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// UPDATE water addition
router.put('/additions/:id', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const { id } = req.params;
    const { jerrycans_added, liters_per_jerrycan, buying_price_per_jerrycan, selling_price_per_jerrycan, bottle_price = 0, supplier_name, date, status } = req.body;
    if (!jerrycans_added || !liters_per_jerrycan) {
      return res.status(400).json({ error: 'Jerrycans and liters are required' });
    }
    const buying = parseFloat(buying_price_per_jerrycan) || 0;
    const selling = parseFloat(selling_price_per_jerrycan) || 0;
    const bottlePrice = parseFloat(bottle_price) || 0;
    const jerrycanStatus = status === 'empty' ? 'empty' : 'filled';
    const total_liters = jerrycanStatus === 'filled' ? jerrycans_added * liters_per_jerrycan : 0;
    // For filled jerrycans: cost = water cost only (we swap bottles with distributor)
    // For empty bottles: cost = bottle cost only (we're buying new bottles)
    const total_buying_cost = jerrycanStatus === 'filled' 
      ? jerrycans_added * buying  // Water cost only for filled
      : jerrycans_added * bottlePrice;  // Bottle cost only for empty
    const total_selling_price = jerrycans_added * selling;
    const expected_profit = total_selling_price - total_buying_cost;
    
    // Fix date format - ensure it's YYYY-MM-DD
    let dateVal = new Date().toISOString().split('T')[0];
    if (date) {
      const d = new Date(date);
      if (!isNaN(d.getTime())) {
        dateVal = d.toISOString().split('T')[0];
      }
    }
    
    // Get the original record details
    const [existingRecord] = await pool.query('SELECT water_name, jerrycans_added, status as original_status FROM water_additions WHERE id = ?', [id]);
    const waterName = existingRecord[0]?.water_name || '';
    const originalQty = existingRecord[0]?.jerrycans_added || 0;
    const originalStatus = existingRecord[0]?.original_status || 'filled';
    const quantityDiff = jerrycans_added - originalQty;
    
    await pool.query(
      'UPDATE water_additions SET jerrycans_added = ?, liters_per_jerrycan = ?, total_liters = ?, buying_price_per_jerrycan = ?, selling_price_per_jerrycan = ?, bottle_price = ?, status = ?, total_buying_cost = ?, total_selling_price = ?, expected_profit = ?, supplier_name = ?, date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [jerrycans_added, liters_per_jerrycan, total_liters, buying, selling, bottlePrice, jerrycanStatus, total_buying_cost, total_selling_price, expected_profit, supplier_name || '', dateVal, id]
    );
    
    // Handle empty bottle stock changes for filled water purchases
    if (jerrycanStatus === 'filled' && quantityDiff !== 0) {
      // If quantity increased, we need more empty bottles to give to distributor
      // If quantity decreased, we get empty bottles back
      const [emptyRows] = await pool.query(
        'SELECT id, quantity FROM water_jerrycans WHERE water_name = ? AND capacity = ? AND status = ? LIMIT 1',
        [waterName, liters_per_jerrycan, 'empty']
      );
      
      if (quantityDiff > 0) {
        // More filled water = reduce more empty bottles
        if (emptyRows.length > 0) {
          const newEmptyQty = emptyRows[0].quantity - quantityDiff;
          if (newEmptyQty <= 0) {
            await pool.query('DELETE FROM water_jerrycans WHERE id = ?', [emptyRows[0].id]);
          } else {
            await pool.query('UPDATE water_jerrycans SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newEmptyQty, emptyRows[0].id]);
          }
        }
      } else {
        // Less filled water = restore empty bottles
        const restoreQty = Math.abs(quantityDiff);
        if (emptyRows.length > 0) {
          await pool.query('UPDATE water_jerrycans SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [restoreQty, emptyRows[0].id]);
        } else {
          await pool.query(
            'INSERT INTO water_jerrycans (water_name, capacity, status, quantity, serial_number, created_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
            [waterName, liters_per_jerrycan, 'empty', restoreQty, `STOCK-${waterName}-${liters_per_jerrycan}L-empty`]
          );
        }
      }
    }
    
    // Update the corresponding filled stock
    const [stockRows] = await pool.query(
      'SELECT id, quantity FROM water_jerrycans WHERE reference_id = ?',
      [id]
    );
    
    if (stockRows.length > 0) {
      // Update existing stock
      await pool.query(
        'UPDATE water_jerrycans SET quantity = quantity + ?, selling_price = ?, bottle_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [quantityDiff, selling, bottlePrice, stockRows[0].id]
      );
    }
    
    if (userId) {
      await logActivity({
        userId: parseInt(userId),
        actionType: 'update',
        entityType: 'water_addition',
        entityId: parseInt(id),
        entityName: `Water Purchase #${id}`,
        description: `yahuje igura amazi #${id}`,
        metadata: { jerrycans_added, total_buying_cost, quantity_diff: quantityDiff }
      });
    }
    
    res.json({ success: true, message: 'Purchase updated' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE water addition - FIXED VERSION
router.delete('/additions/:id', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const { id } = req.params;
    
    // First get the purchase details to find matching stock
    const [purchaseRows] = await pool.query('SELECT * FROM water_additions WHERE id = ?', [id]);
    
    if (purchaseRows.length === 0) {
      return res.status(404).json({ error: 'Purchase not found' });
    }
    
    const purchase = purchaseRows[0];
    const { 
      water_name, 
      capacity, 
      status, 
      liters_per_jerrycan,
      selling_price_per_jerrycan,
      bottle_price 
    } = purchase;
    
    // Check if any sales reference this purchase
    const [salesCheck] = await pool.query(
      'SELECT COUNT(*) as sale_count FROM water_sales WHERE purchase_id = ?',
      [id]
    );
    
    if (salesCheck[0]?.sale_count > 0) {
      return res.status(400).json({
        error: `Cannot delete purchase #${id}. ${salesCheck[0].sale_count} sales reference this purchase. Delete those sales first.`
      });
    }
    
    const jerrycans_added = purchase.jerrycans_added || 0;
    
    // If this was a filled water purchase, restore empty bottles (reverse the swap)
    if (status === 'filled' && jerrycans_added > 0) {
      // Add back to empty stock (you get your empty bottles back)
      const [emptyRows] = await pool.query(
        'SELECT id, quantity FROM water_jerrycans WHERE water_name = ? AND capacity = ? AND status = ? LIMIT 1',
        [water_name, liters_per_jerrycan, 'empty']
      );
      
      if (emptyRows.length > 0) {
        await pool.query(
          'UPDATE water_jerrycans SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [jerrycans_added, emptyRows[0].id]
        );
      } else {
        // Create empty stock record
        await pool.query(
          'INSERT INTO water_jerrycans (water_name, capacity, status, quantity, serial_number, created_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
          [water_name, liters_per_jerrycan, 'empty', jerrycans_added, `STOCK-${water_name}-${liters_per_jerrycan}L-empty`]
        );
      }
    }
    
    // Delete filled stock linked to this purchase - TWO METHODS:
    // Method 1: Delete by reference_id
    await pool.query('DELETE FROM water_jerrycans WHERE reference_id = ?', [id]);
    
    // Method 2: Also reduce quantity by matching attributes (in case reference_id wasn't set)
    const [filledRows] = await pool.query(
      'SELECT id, quantity FROM water_jerrycans WHERE water_name = ? AND capacity = ? AND status = ? AND reference_id IS NULL LIMIT 1',
      [water_name, liters_per_jerrycan, status]
    );
    
    if (filledRows.length > 0) {
      const newQty = filledRows[0].quantity - jerrycans_added;
      if (newQty <= 0) {
        await pool.query('DELETE FROM water_jerrycans WHERE id = ?', [filledRows[0].id]);
      } else {
        await pool.query('UPDATE water_jerrycans SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newQty, filledRows[0].id]);
      }
    }
    
    // Delete the purchase
    await pool.query('DELETE FROM water_additions WHERE id = ?', [id]);
    
    if (userId) {
      await logActivity({
        userId: parseInt(userId),
        actionType: 'delete',
        entityType: 'water_addition',
        entityId: parseInt(id),
        entityName: `Water Purchase #${id}`,
        description: `yasibe igura amazi #${id} na stock yayo`,
        metadata: { 
          water_name, 
          capacity: liters_per_jerrycan,
          status 
        }
      });
    }
    
    res.json({ 
      success: true, 
      message: 'Purchase and linked stock deleted successfully'
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// GET recent additions
router.get('/recent-additions', async (req, res) => {
  try {
    const [additions] = await pool.query(
      'SELECT * FROM water_additions ORDER BY created_at DESC LIMIT 10'
    );
    
    res.json({
      success: true,
      data: additions
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET water stats
router.get('/stats', async (req, res) => {
  try {
    // Total jerrycans
    const [totalJerrycans] = await pool.query('SELECT SUM(COALESCE(quantity, 1)) as count FROM water_jerrycans');
    
    // Total liters (Current Available Water)
    const [totalLiters] = await pool.query('SELECT SUM(capacity * COALESCE(quantity, 1)) as total FROM water_jerrycans WHERE status = "filled"');
    
    // Total cost
    const [totalCost] = await pool.query('SELECT SUM(total_buying_cost) as total FROM water_additions');
    
    // Today's additions
    const [todayAdditions] = await pool.query(
      'SELECT COUNT(*) as count FROM water_additions WHERE DATE(created_at) = CURDATE()'
    );
    
    res.json({
      success: true,
      data: {
        totalJerrycans: totalJerrycans[0].count || 0,
        totalLiters: totalLiters[0].total || 0,
        totalCost: parseFloat(totalCost[0].total || 0),
        todayAdditions: todayAdditions[0].count || 0
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET jerrycans
router.get('/jerrycans', async (req, res) => {
  try {
    const [jerrycans] = await pool.query(
      `SELECT j.*, a.supplier_name, a.date as purchase_date 
       FROM water_jerrycans j 
       LEFT JOIN water_additions a ON j.reference_id = a.id 
       ORDER BY j.created_at DESC`
    );
    
    res.json({
      success: true,
      data: jerrycans
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// UPDATE jerrycan status
router.patch('/jerrycans/:id/status', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const { id } = req.params;
    const { status } = req.body;
    
    if (!['filled', 'empty', 'maintenance'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    
    await pool.query(
      'UPDATE water_jerrycans SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [status, id]
    );
    
    // Log activity
    if (userId) {
      await logActivity({
        userId: parseInt(userId),
        actionType: 'update',
        entityType: 'water_jerrycan',
        entityId: parseInt(id),
        entityName: `Jerrycan #${id}`,
        description: `yahinduriye imiterere ya jerrycan #${id} kuri "${status}"`,
        metadata: { status }
      });
    }
    
    res.json({
      success: true,
      message: 'Jerrycan status updated successfully'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ADD new jerrycans
router.post('/jerrycans', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const { count, capacity = 20 } = req.body;
    
    if (!count || count < 1) {
      return res.status(400).json({ error: 'Valid count is required' });
    }
    
    const addedJerrycans = [];
    for (let i = 0; i < count; i++) {
      const [result] = await pool.query(
        'INSERT INTO water_jerrycans (capacity, status, serial_number, created_at) VALUES (?, "empty", ?, CURRENT_TIMESTAMP)',
        [capacity, `JRC-${Date.now()}-${i}`]
      );
      addedJerrycans.push({
        id: result.insertId,
        serial_number: `JRC-${Date.now()}-${i}`,
        capacity,
        status: 'empty'
      });
    }
    
    // Log activity
    if (userId) {
      await logActivity({
        userId: parseInt(userId),
        actionType: 'create',
        entityType: 'water_jerrycan',
        entityId: addedJerrycans[0]?.id,
        entityName: `${count} New Jerrycans`,
        description: `yongeremo jerrycans ${count} nshya`,
        metadata: { count, capacity }
      });
    }
    
    res.json({
      success: true,
      data: addedJerrycans
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET jerrycan stats
router.get('/jerrycan-stats', async (req, res) => {
  try {
    const [stats] = await pool.query(`
      SELECT 
        SUM(COALESCE(quantity, 1)) as total,
        SUM(CASE WHEN status = 'filled' THEN COALESCE(quantity, 1) ELSE 0 END) as filled,
        SUM(CASE WHEN status = 'empty' THEN COALESCE(quantity, 1) ELSE 0 END) as empty_count,
        SUM(CASE WHEN status = 'maintenance' THEN COALESCE(quantity, 1) ELSE 0 END) as maintenance
      FROM water_jerrycans
    `);
    
    res.json({
      success: true,
      data: {
        total: stats[0].total || 0,
        filled: stats[0].filled || 0,
        empty: stats[0].empty_count || 0,
        inMaintenance: stats[0].maintenance || 0
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET water reports
router.get('/reports', async (req, res) => {
  try {
    const { period, start_date, end_date } = req.query;
    let dateFilter = '';
    let params = [];
    
    if (period === 'today') {
      dateFilter = 'DATE(created_at) = CURDATE()';
    } else if (period === 'yesterday') {
      dateFilter = 'DATE(created_at) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)';
    } else if (period === 'this_week') {
      dateFilter = 'DATE(created_at) >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)';
    } else if (period === 'this_month') {
      dateFilter = 'MONTH(created_at) = MONTH(CURDATE()) AND YEAR(created_at) = YEAR(CURDATE())';
    } else if (start_date && end_date) {
      dateFilter = 'DATE(created_at) BETWEEN ? AND ?';
      params = [start_date, end_date];
    }
    
    // Get sales
    let salesQuery = 'SELECT * FROM water_sales';
    if (dateFilter) {
      salesQuery += ' WHERE ' + dateFilter;
    }
    salesQuery += ' ORDER BY created_at DESC';
    
    const [sales] = await pool.query(salesQuery, params);
    
    // Get additions
    let additionsQuery = 'SELECT * FROM water_additions';
    if (dateFilter) {
      additionsQuery += ' WHERE ' + dateFilter;
    }
    additionsQuery += ' ORDER BY created_at DESC';
    
    const [additions] = await pool.query(additionsQuery, params);
    const additionsWithCost = additions.map(a => ({ ...a, total_cost: a.total_buying_cost || a.total_cost || 0 }));
    
    // Calculate summary using stored profit values from sales
    const totalSalesCount = sales.reduce((sum, sale) => sum + (sale.jerrycans_sold || 0), 0);
    const totalRevenue = sales.reduce((sum, sale) => sum + parseFloat(sale.total_amount || 0), 0);
    const totalProfit = sales.reduce((sum, sale) => sum + parseFloat(sale.profit || 0), 0);
    const totalAdditions = additions.reduce((sum, addition) => sum + (addition.jerrycans_added || 0), 0);
    const totalCost = additions.reduce((sum, addition) => sum + parseFloat(addition.total_buying_cost || addition.total_cost || 0), 0);
    
    res.json({
      success: true,
      data: {
        sales,
        additions: additionsWithCost,
        summary: {
          totalSales: totalSalesCount,
          totalRevenue,
          totalProfit,
          totalAdditions,
          totalCost
        }
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;