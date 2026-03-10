const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { logActivity } = require('../utils/activityLogger');

// Auto-migrate: Create water_bottle_items table and add required columns
(async () => {
  try {
    // Create water_bottle_items table if it doesn't exist
    await pool.query(`
      CREATE TABLE  water_bottle_items (
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
      )
    `);
    console.log('✅ water_bottle_items table ready');
  } catch (err) {
    console.log('water_bottle_items migration:', err.message);
  }
})();

// ============================================================
// BOTTLE ITEMS CRUD
// ============================================================

// GET all bottle items
router.get('/bottle-items', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT *, (filled_stock + empty_stock) as total_stock,
             (filled_stock * buying_price) as total_investment
      FROM water_bottle_items
      ORDER BY created_at DESC
    `);
    res.json({ success: true, data: rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET single bottle item
router.get('/bottle-items/:id', async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT *, (filled_stock + empty_stock) as total_stock FROM water_bottle_items WHERE id = ?',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ success: false, error: 'Item not found' });
    res.json({ success: true, data: rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST create bottle item
router.post('/bottle-items', async (req, res) => {
  try {
    const {
      water_name, capacity_liters, bottle_type,
      buying_price, selling_price, bottle_selling_price, bottle_cost,
      filled_stock = 0, empty_stock = 0, min_stock = 5, status = 'active'
    } = req.body;

    if (!water_name) return res.status(400).json({ success: false, error: 'water_name is required' });
    if (!capacity_liters) return res.status(400).json({ success: false, error: 'capacity_liters is required' });

    const [result] = await pool.query(
      `INSERT INTO water_bottle_items
        (water_name, capacity_liters, bottle_type, buying_price, selling_price, bottle_selling_price, bottle_cost, filled_stock, empty_stock, min_stock, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [water_name, capacity_liters, bottle_type || 'plastic', buying_price, selling_price, bottle_selling_price, bottle_cost, filled_stock, empty_stock, min_stock, status]
    );

    const [newItem] = await pool.query('SELECT * FROM water_bottle_items WHERE id = ?', [result.insertId]);
    res.status(201).json({ success: true, data: newItem[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT update bottle item
router.put('/bottle-items/:id', async (req, res) => {
  try {
    const {
      water_name, capacity_liters, bottle_type,
      buying_price, selling_price, bottle_selling_price, bottle_cost,
      filled_stock, empty_stock, min_stock, status
    } = req.body;

    const [existing] = await pool.query('SELECT id FROM water_bottle_items WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ success: false, error: 'Item not found' });

    await pool.query(
      `UPDATE water_bottle_items SET
        water_name = ?, capacity_liters = ?, bottle_type = ?,
        buying_price = ?, selling_price = ?, bottle_selling_price = ?, bottle_cost = ?,
        filled_stock = ?, empty_stock = ?, min_stock = ?, status = ?
       WHERE id = ?`,
      [water_name, capacity_liters, bottle_type || 'plastic', buying_price, selling_price, bottle_selling_price, bottle_cost,
       filled_stock, empty_stock, min_stock || 5, status || 'active', req.params.id]
    );

    const [updated] = await pool.query(
      'SELECT *, (filled_stock + empty_stock) as total_stock FROM water_bottle_items WHERE id = ?',
      [req.params.id]
    );
    res.json({ success: true, data: updated[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE bottle item
router.delete('/bottle-items/:id', async (req, res) => {
  try {
    const [existing] = await pool.query('SELECT id FROM water_bottle_items WHERE id = ?', [req.params.id]);
    if (existing.length === 0) return res.status(404).json({ success: false, error: 'Item not found' });

    // Check if this item has been used in any water sales
    const [salesCheck] = await pool.query(
      'SELECT COUNT(*) as sale_count FROM water_sales WHERE water_bottle_item_id = ?',
      [req.params.id]
    );

    if (salesCheck[0]?.sale_count > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot delete this item. It has been used in ${salesCheck[0].sale_count} water sales. Items that have been sold cannot be deleted.`
      });
    }

    // Check if this item has been used in any water purchases
    const [purchaseCheck] = await pool.query(
      'SELECT COUNT(*) as purchase_count FROM water_additions WHERE water_bottle_item_id = ?',
      [req.params.id]
    );

    if (purchaseCheck[0]?.purchase_count > 0) {
      return res.status(400).json({
        success: false,
        error: `Cannot delete this item. It has been used in ${purchaseCheck[0].purchase_count} water purchases. Items with purchase history cannot be deleted.`
      });
    }

    await pool.query('DELETE FROM water_bottle_items WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Bottle item deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// END BOTTLE ITEMS CRUD
// ============================================================

// Auto-migrate: Add required columns and consolidate to quantity-based
(async () => {
  try {
    await pool.query(`ALTER TABLE water_additions ADD COLUMN  bottle_price DECIMAL(10, 2) DEFAULT 0`);
    await pool.query(`ALTER TABLE water_additions ADD COLUMN  purchase_type ENUM('water', 'bottles') DEFAULT 'water'`);
    await pool.query(`ALTER TABLE water_additions ADD COLUMN  water_bottle_item_id INT NULL`);
    await pool.query(`ALTER TABLE water_additions ADD COLUMN  empty_bottles_returned INT DEFAULT 0`);
    await pool.query(`ALTER TABLE water_additions ADD COLUMN  status ENUM('filled', 'empty') DEFAULT 'filled'`);

    // Ensure water_bottle_items has all required stock columns
    await pool.query(`ALTER TABLE water_bottle_items ADD COLUMN  filled_stock INT DEFAULT 0`);
    await pool.query(`ALTER TABLE water_bottle_items ADD COLUMN  empty_stock INT DEFAULT 0`);
    await pool.query(`ALTER TABLE water_bottle_items ADD COLUMN  bottle_selling_price DECIMAL(10, 2) NOT NULL DEFAULT 0`);
    await pool.query(`ALTER TABLE water_bottle_items ADD COLUMN  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`);
    console.log('[migration] water_bottle_items columns ensured');
    
    // Add quantity column to water_jerrycans if it doesn't exist
    await pool.query(`ALTER TABLE water_jerrycans ADD COLUMN  quantity INT DEFAULT 1`);
    
    // Add purchase_id to water_sales for tracking
    await pool.query(`ALTER TABLE water_sales ADD COLUMN  purchase_id INT NULL`);
    
    // Add reference_id to water_jerrycans for linking to purchases
    await pool.query(`ALTER TABLE water_jerrycans ADD COLUMN  reference_id INT NULL`);
    
    // Add water_price and bottle_price_sold columns to water_sales for accurate profit tracking
    await pool.query(`ALTER TABLE water_sales ADD COLUMN  water_price DECIMAL(10, 2) DEFAULT 0`);
    await pool.query(`ALTER TABLE water_sales ADD COLUMN  bottle_price_sold DECIMAL(10, 2) DEFAULT 0`);
    await pool.query(`ALTER TABLE water_sales ADD COLUMN  water_bottle_item_id INT NULL`);
    await pool.query(`ALTER TABLE water_sales ADD COLUMN  sale_type ENUM('water_only','water_with_exchange','bottle_only') NULL`);
    await pool.query(`ALTER TABLE water_sales ADD COLUMN  status VARCHAR(20) DEFAULT 'Paid'`);
    
    // Check if we need to consolidate (if there are many rows with quantity=1)
    const [checkRows] = await pool.query(`SELECT COUNT(*) as cnt FROM water_jerrycans WHERE quantity = 1`);
    const rowCount = checkRows[0]?.cnt || 0;
    
    if (rowCount > 50) {
      console.log('🔄 Consolidating water_jerrycans rows...');
      // Consolidate rows by water_name, capacity, status
      await pool.query(`
        CREATE TEMPORARY TABLE  temp_consolidated AS
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

// GET unique water names from purchases (for suggestions in AddWaterModal)
router.get('/water-names', async (req, res) => {
  try {
    // Get unique water names from both purchases and stock
    const [rows] = await pool.query(`
      SELECT DISTINCT water_name 
      FROM (
        SELECT water_name FROM water_additions WHERE water_name IS NOT NULL AND water_name != ''
        UNION
        SELECT water_name FROM water_jerrycans WHERE water_name IS NOT NULL AND water_name != ''
      ) AS combined
      ORDER BY water_name
    `);
    
    const waterNames = rows.map((r, index) => ({
      id: index + 1,
      name: r.water_name
    }));
    
    res.json({ success: true, data: waterNames });
  } catch (error) {
    console.error('Error in water-names:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET water sales with filtering
router.get('/sales', async (req, res) => {
  try {
    const { period, start_date, end_date, water_name } = req.query;
    let dateFilter = '';
    let waterNameFilter = '';
    
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
    // Note: 'all' period means no date filter
    
    if (water_name) {
      waterNameFilter = 's.water_name = ?';
    }
    
    let query = `
SELECT s.*,
       COALESCE(s.sale_type, CASE
         WHEN s.customer_brings_bottle = 1 THEN 'water_with_exchange'
         WHEN s.includes_bottle = 1 AND (s.water_price IS NULL OR s.water_price = 0) THEN 'bottle_only'
         WHEN s.includes_bottle = 1 THEN 'water_only'
         ELSE 'bottle_only'
       END) AS sale_type,
       a.supplier_name as purchase_supplier,
       a.buying_price_per_jerrycan as purchase_water_cost,
       a.bottle_price as purchase_bottle_cost,
       a.date as purchase_date,
       COALESCE(wbi.bottle_cost, 0) as item_bottle_cost,
       CASE
         WHEN COALESCE(s.sale_type, CASE
           WHEN s.customer_brings_bottle = 1 THEN 'water_with_exchange'
           WHEN s.includes_bottle = 1 AND (s.water_price IS NULL OR s.water_price = 0) THEN 'bottle_only'
           WHEN s.includes_bottle = 1 THEN 'water_only'
           ELSE 'bottle_only'
         END) = 'bottle_only'
           THEN 0
         WHEN s.customer_brings_bottle = 1
           THEN (COALESCE(s.water_price, s.price_per_jerrycan) - COALESCE(a.buying_price_per_jerrycan, wbi.buying_price, 0)) * s.jerrycans_sold
         WHEN s.includes_bottle = 1
           THEN (COALESCE(s.water_price, s.price_per_jerrycan) - COALESCE(a.buying_price_per_jerrycan, wbi.buying_price, 0)) * s.jerrycans_sold
         ELSE 0
       END AS water_profit,

       CASE
         WHEN COALESCE(s.sale_type, CASE
           WHEN s.customer_brings_bottle = 1 THEN 'water_with_exchange'
           WHEN s.includes_bottle = 1 AND (s.water_price IS NULL OR s.water_price = 0) THEN 'bottle_only'
           WHEN s.includes_bottle = 1 THEN 'water_only'
           ELSE 'bottle_only'
         END) = 'water_only'
           THEN (COALESCE(s.bottle_price_sold, 0) - COALESCE(wbi.bottle_cost, 0)) * s.jerrycans_sold
         WHEN COALESCE(s.sale_type, CASE
           WHEN s.customer_brings_bottle = 1 THEN 'water_with_exchange'
           WHEN s.includes_bottle = 1 AND (s.water_price IS NULL OR s.water_price = 0) THEN 'bottle_only'
           WHEN s.includes_bottle = 1 THEN 'water_only'
           ELSE 'bottle_only'
         END) = 'bottle_only'
           THEN (COALESCE(s.bottle_price_sold, s.price_per_jerrycan) - COALESCE(wbi.bottle_cost, 0)) * s.jerrycans_sold
         ELSE 0
       END AS bottle_profit,

       CASE
         -- AMAZI GUSA (customer brings bottle)
         WHEN s.customer_brings_bottle = 1
           THEN (COALESCE(s.water_price, s.price_per_jerrycan) - COALESCE(a.buying_price_per_jerrycan, wbi.buying_price, 0)) * s.jerrycans_sold
         
         -- ICUPA GUSA (bottle only)
         WHEN s.includes_bottle = 1 AND (s.water_price IS NULL OR s.water_price = 0)
           THEN ((s.bottle_price_sold) - (wbi.bottle_cost)) * s.jerrycans_sold
         -- AMAZI + ICUPA (water and bottle)
         WHEN s.includes_bottle = 1
           THEN (COALESCE(s.water_price, s.price_per_jerrycan) - COALESCE(a.buying_price_per_jerrycan, wbi.buying_price, 0)) * s.jerrycans_sold
         
         -- Default
         ELSE COALESCE(s.profit, 0)
       END AS profit,

       (
         (
           CASE
             WHEN COALESCE(s.sale_type, CASE
               WHEN s.customer_brings_bottle = 1 THEN 'water_with_exchange'
               WHEN s.includes_bottle = 1 AND (s.water_price IS NULL OR s.water_price = 0) THEN 'bottle_only'
               WHEN s.includes_bottle = 1 THEN 'water_only'
               ELSE 'bottle_only'
             END) = 'bottle_only'
               THEN 0
             WHEN s.customer_brings_bottle = 1
               THEN (COALESCE(s.water_price, s.price_per_jerrycan) - COALESCE(a.buying_price_per_jerrycan, wbi.buying_price, 0)) * s.jerrycans_sold
             WHEN s.includes_bottle = 1
               THEN (COALESCE(s.water_price, s.price_per_jerrycan) - COALESCE(a.buying_price_per_jerrycan, wbi.buying_price, 0)) * s.jerrycans_sold
             ELSE 0
           END
         )
         +
         (
           CASE
             WHEN COALESCE(s.sale_type, CASE
               WHEN s.customer_brings_bottle = 1 THEN 'water_with_exchange'
               WHEN s.includes_bottle = 1 AND (s.water_price IS NULL OR s.water_price = 0) THEN 'bottle_only'
               WHEN s.includes_bottle = 1 THEN 'water_only'
               ELSE 'bottle_only'
             END) = 'water_only'
               THEN (COALESCE(s.bottle_price_sold, 0) - COALESCE(wbi.bottle_cost, 0)) * s.jerrycans_sold
             WHEN COALESCE(s.sale_type, CASE
               WHEN s.customer_brings_bottle = 1 THEN 'water_with_exchange'
               WHEN s.includes_bottle = 1 AND (s.water_price IS NULL OR s.water_price = 0) THEN 'bottle_only'
               WHEN s.includes_bottle = 1 THEN 'water_only'
               ELSE 'bottle_only'
             END) = 'bottle_only'
               THEN (COALESCE(s.bottle_price_sold, s.price_per_jerrycan) - COALESCE(wbi.bottle_cost, 0)) * s.jerrycans_sold
             ELSE 0
           END
         )
       ) AS profit_total
FROM water_sales s
LEFT JOIN water_additions a ON s.purchase_id = a.id
LEFT JOIN water_bottle_items wbi ON s.water_bottle_item_id = wbi.id
    `;
    let params = [];
    
    // Combine filters with WHERE clause
    const filters = [];
    if (dateFilter) filters.push(dateFilter);
    if (waterNameFilter) filters.push(waterNameFilter);
    
    if (filters.length > 0) {
      query += ' WHERE ' + filters.join(' AND ');
      if (start_date && end_date) {
        params = [start_date, end_date];
      }
      if (water_name) {
        params.push(water_name);
      }
    }
    
    query += ' ORDER BY s.created_at DESC';
    
    const [sales] = await pool.query(query, params);
    
    // Add debt information for each sale
    const salesWithDebtInfo = [];
    for (const sale of sales) {
      const saleFinalAmount = Number(sale.total_amount) || 0;
      let paid_so_far = sale.status === 'Paid' ? saleFinalAmount : 0;
      let balance = Math.max(0, saleFinalAmount - paid_so_far);

      // Check for linked debt
      const [linkedDebts] = await pool.query(
        "SELECT id, amount FROM debts WHERE type = 'debtor' AND description = ? LIMIT 1",
        [`Sale #${sale.id}`]
      );

      if (linkedDebts.length > 0) {
        const debt = linkedDebts[0];
        const [[{ total_paid }]] = await pool.query(
          'SELECT COALESCE(SUM(amount), 0) as total_paid FROM debt_installments WHERE debt_id = ?',
          [debt.id]
        );
        const debtAmount = Number(debt.amount) || 0;
        paid_so_far = Number(total_paid) || 0;
        balance = Math.max(0, debtAmount - paid_so_far);
      }

      salesWithDebtInfo.push({
        ...sale,
        paid_so_far,
        balance
      });
    }
    
    // Calculate summary using stored profit values
    const totalLiters = salesWithDebtInfo.reduce((sum, sale) => sum + (sale.jerrycans_sold * (sale.capacity || 20)), 0);
    const totalRevenue = salesWithDebtInfo.reduce((sum, sale) => sum + parseFloat(sale.total_amount || 0), 0);
    const totalProfit = salesWithDebtInfo.reduce((sum, sale) => sum + parseFloat(sale.profit || 0), 0);
    const salesCount = salesWithDebtInfo.length;

    const summary = {
      totalLiters,
      totalRevenue,
      totalProfit,
      salesCount
    };
    
    res.json({
      success: true,
      data: {
        sales: salesWithDebtInfo,
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
    const { jerrycans_sold, price_per_jerrycan, customer_name, payment_method, notes, water_name, capacity, customer_brings_bottle, includes_bottle, water_price, bottle_price, water_bottle_item_id, empty_bottles_returned = 0, sale_type, paid_amount } = req.body;

    if (!jerrycans_sold || !price_per_jerrycan) {
      return res.status(400).json({ error: 'Jerrycans sold and price per jerrycan are required' });
    }

    const total_amount = jerrycans_sold * price_per_jerrycan;
    
    // Handle payment amounts and status
    const normalizedFinalAmount = Number(total_amount) || 0;
    const rawPaidAmount = paid_amount === undefined || paid_amount === null
      ? (payment_method === 'Loan' ? 0 : normalizedFinalAmount)
      : Number(paid_amount);
    const normalizedPaidAmount = Math.max(0, Math.min(normalizedFinalAmount, Number.isFinite(rawPaidAmount) ? rawPaidAmount : 0));
    const normalizedStatus = normalizedPaidAmount >= normalizedFinalAmount ? 'Paid' : 'Partial';
    const remainingAmount = Math.max(0, normalizedFinalAmount - normalizedPaidAmount);
    const custName = customer_name && String(customer_name).trim() ? String(customer_name).trim() : 'Client';
    const wName = water_name && String(water_name).trim() ? String(water_name).trim() : null;
    const cap = capacity != null ? parseInt(capacity, 10) : null;
    const customerBringsBottle = customer_brings_bottle === true;
    const includesBottle = includes_bottle === true;
    
    // Store the water and bottle prices from the sale
    const saleWaterPrice = parseFloat(water_price) || 0;
    const saleBottlePrice = parseFloat(bottle_price) || 0;

    // For bottle_only sales, skip filled stock check entirely
    let stockId = null, currentQty = 0, purchaseId = null;
    if (sale_type !== 'bottle_only') {
      // If water_bottle_item_id is provided, check stock from water_bottle_items table
      if (water_bottle_item_id) {
        console.log(`[STOCK CHECK] Using water_bottle_item_id: ${water_bottle_item_id}`);
        
        const [itemRows] = await pool.query(
          'SELECT id, water_name, capacity_liters, filled_stock, empty_stock FROM water_bottle_items WHERE id = ?',
          [water_bottle_item_id]
        );
        
        if (itemRows.length === 0) {
          return res.status(400).json({ error: 'Water item not found' });
        }
        
        const item = itemRows[0];
        const availableFilled = item.filled_stock || 0;
        
        console.log(`[STOCK CHECK] Item found: ${item.water_name} ${item.capacity_liters}L, filled_stock: ${availableFilled}`);
        
        if (availableFilled < jerrycans_sold) {
          return res.status(400).json({ error: `Amacupa ahari ni ${availableFilled} gusa` });
        }
        
        // For water_bottle_items, we use the item ID as stockId
        stockId = water_bottle_item_id;
        currentQty = availableFilled;
        // Note: water_bottle_items don't have reference_id, set to null
        purchaseId = null;
        
      } else {
        // Fallback to old water_jerrycans logic for legacy sales
        const searchWaterName = wName || 'Water';
        const searchCapacity = cap || 20;
        console.log(`[STOCK CHECK] Fallback: Searching water_jerrycans for: water_name='${searchWaterName}', capacity=${searchCapacity}`);
        
        const [stockRows] = await pool.query(
          'SELECT id, COALESCE(quantity, 1) as quantity, reference_id FROM water_jerrycans WHERE status = ? AND water_name = ? AND capacity = ? LIMIT 1',
          ['filled', searchWaterName, searchCapacity]
        );
        
        if (stockRows.length === 0 || stockRows[0].quantity < jerrycans_sold) {
          const available = stockRows.length > 0 ? stockRows[0].quantity : 0;
          return res.status(400).json({ error: `Amacupa ahari ni ${available} gusa` });
        }
        
        stockId = stockRows[0].id;
        currentQty = stockRows[0].quantity;
        purchaseId = stockRows[0].reference_id;
      }
    }
    
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

    // For bottle_only, get bottle_cost from water_bottle_items (no purchaseId available)
    if (sale_type === 'bottle_only' && water_bottle_item_id) {
      const [itemRows] = await pool.query(
        'SELECT bottle_cost FROM water_bottle_items WHERE id = ?',
        [water_bottle_item_id]
      );
      if (itemRows.length > 0) {
        purchaseBottlePrice = parseFloat(itemRows[0].bottle_cost) || 0;
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
      'INSERT INTO water_sales (water_name, capacity, jerrycans_sold, price_per_jerrycan, total_amount, profit, customer_name, payment_method, notes, customer_brings_bottle, includes_bottle, purchase_id, water_price, bottle_price_sold, sale_type, water_bottle_item_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [wName || 'Water', cap || 20, jerrycans_sold, price_per_jerrycan, total_amount, profit, custName, payment_method || 'cash', notes || '', customerBringsBottle, includesBottle, purchaseId, saleWaterPrice, saleBottlePrice, sale_type || null, water_bottle_item_id || null, normalizedStatus]
    );

    const saleId = result.insertId;

    // Create debt record + initial installment for partial/loan sales
    let debtId = null;
    if (remainingAmount > 0 && custName !== 'Client') {
      const due = new Date();
      due.setDate(due.getDate() + 30);
      const dueDate = due.toISOString().split('T')[0];

      const debtDescription = `Sale #${saleId}`;
      const [debtResult] = await pool.query(
        'INSERT INTO debts (type, person, amount, date, due_date, description, status, phone, email) VALUES (?, ?, ?, CURDATE(), ?, ?, ?, ?, ?)',
        ['debtor', custName, normalizedFinalAmount, dueDate, debtDescription, 'pending', '', '']
      );
      debtId = debtResult.insertId;

      // Add initial payment if any
      if (normalizedPaidAmount > 0) {
        await pool.query(
          'INSERT INTO debt_installments (debt_id, amount, payment_date, notes) VALUES (?, ?, CURDATE(), ?)',
          [debtId, normalizedPaidAmount, `Initial payment for Sale #${saleId}`]
        );
      }
    }

    // Handle water_jerrycans stock — skip entirely for bottle_only
    if (sale_type !== 'bottle_only' && stockId) {
      if (includesBottle && !customerBringsBottle) {
        const newQty = currentQty - jerrycans_sold;
        if (newQty <= 0) {
          await pool.query('DELETE FROM water_jerrycans WHERE id = ?', [stockId]);
        } else {
          await pool.query('UPDATE water_jerrycans SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newQty, stockId]);
        }
      } else {
        const newFilledQty = currentQty - jerrycans_sold;
        if (newFilledQty <= 0) {
          await pool.query('DELETE FROM water_jerrycans WHERE id = ?', [stockId]);
        } else {
          await pool.query('UPDATE water_jerrycans SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newFilledQty, stockId]);
        }
        const [emptyRows] = await pool.query(
          'SELECT id, quantity FROM water_jerrycans WHERE status = ? AND water_name = ? AND capacity = ? LIMIT 1',
          ['empty', wName || 'Water', cap || 20]
        );
        if (emptyRows.length > 0) {
          await pool.query('UPDATE water_jerrycans SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [jerrycans_sold, emptyRows[0].id]);
        } else {
          const uniqueSerial = `STOCK-${wName || 'Water'}-${cap || 20}L-empty-${Date.now()}`;
          await pool.query(
            'INSERT INTO water_jerrycans (water_name, capacity, status, serial_number, selling_price, quantity, created_at) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
            [wName || 'Water', cap || 20, 'empty', uniqueSerial, 0, jerrycans_sold]
          );
        }
      }
    }

    // Update water_bottle_items stock based on sale_type
    console.log(`[STOCK UPDATE] water_bottle_item_id: ${water_bottle_item_id}, sale_type: ${sale_type}`);
    if (water_bottle_item_id) {
      const saleType = sale_type;
      if (saleType === 'water_only') {
        // AMAZI + ICUPA: customer takes both water + bottle → filled_stock- ONLY
        await pool.query(
          `UPDATE water_bottle_items SET
            filled_stock = GREATEST(0, filled_stock - ?),
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
          [jerrycans_sold, water_bottle_item_id]
        );
        console.log(`[sale] AMAZI+ICUPA (water_only) → filled_stock -${jerrycans_sold}`);
      } else if (saleType === 'water_with_exchange') {
        // AMAZI: customer brings bottle, gets water, leaves empty → filled_stock-, empty_stock+
        await pool.query(
          `UPDATE water_bottle_items SET
            filled_stock = GREATEST(0, filled_stock - ?),
            empty_stock = empty_stock + ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
          [jerrycans_sold, jerrycans_sold, water_bottle_item_id]
        );
        console.log(`[sale] AMAZI (water_with_exchange) → filled_stock -${jerrycans_sold}, empty_stock +${jerrycans_sold}`);
      } else if (saleType === 'bottle_only') {
        // Sell empty bottle only → empty_stock-
        await pool.query(
          `UPDATE water_bottle_items SET
            empty_stock = GREATEST(0, empty_stock - ?),
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
          [jerrycans_sold, water_bottle_item_id]
        );
        console.log(`[sale] bottle_only → empty_stock -${jerrycans_sold}`);
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
        purchase_id: purchaseId,
        status: normalizedStatus,
        paid_amount: normalizedPaidAmount,
        remaining_amount: remainingAmount,
        debt_id: debtId
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// UPDATE water sale status (for debt sync)
router.patch('/sales/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || (status !== 'Paid' && status !== 'Partial')) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    await pool.query('UPDATE water_sales SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [status, id]);

    // Sync linked debt(s) created from this water sale
    const saleId = parseInt(id);
    if (!Number.isNaN(saleId)) {
      const [linkedDebts] = await pool.query(
        "SELECT id, amount FROM debts WHERE type = 'debtor' AND description = ?",
        [`Sale #${saleId}`]
      );

      for (const debt of linkedDebts) {
        const [[{ total_paid }]] = await pool.query(
          'SELECT COALESCE(SUM(amount), 0) as total_paid FROM debt_installments WHERE debt_id = ?',
          [debt.id]
        );
        const debtAmount = Number(debt.amount) || 0;
        const paid = Number(total_paid) || 0;
        const balance = Math.max(0, debtAmount - paid);

        if (status === 'Paid') {
          if (balance > 0) {
            await pool.query(
              'INSERT INTO debt_installments (debt_id, amount, payment_date, notes) VALUES (?, ?, CURDATE(), ?)',
              [debt.id, balance, `Auto close from Water Sale #${saleId} marked Paid`]
            );
          }
          await pool.query(
            "UPDATE debts SET status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            [debt.id]
          );
        } else {
          const computedStatus = paid >= debtAmount ? 'paid' : 'pending';
          await pool.query(
            'UPDATE debts SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [computedStatus, debt.id]
          );
        }
      }
    }

    res.json({ success: true, id, status });
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
    
    console.log(`[DELETE SALE] Starting delete for sale ID: ${id}`);
    
    // First, get the sale details
    const [saleRows] = await pool.query('SELECT * FROM water_sales WHERE id = ?', [id]);
    
    if (saleRows.length === 0) {
      console.log(`[DELETE SALE] Sale not found: ${id}`);
      return res.status(404).json({ error: 'Sale not found' });
    }
    
    const sale = saleRows[0];
    const { 
      water_name, 
      capacity, 
      jerrycans_sold, 
      purchase_id, 
      sale_type,
      includes_bottle, 
      customer_brings_bottle,
      water_bottle_item_id,
      water_price,
      bottle_price_sold
    } = sale;
    
    // Derive sale_type if not set (for old records)
    let actualSaleType = sale_type;
    if (!actualSaleType) {
      if (!includes_bottle) {
        actualSaleType = 'water_with_exchange'; // AMAZI: no bottle involved
      } else if (includes_bottle && !customer_brings_bottle && parseFloat(water_price || 0) === 0) {
        actualSaleType = 'bottle_only'; // ICUPA: has bottle, no water price
      } else if (includes_bottle && !customer_brings_bottle) {
        actualSaleType = 'water_only'; // AMAZI + ICUPA: has bottle + water price
      } else {
        actualSaleType = 'water_with_exchange'; // AMAZI swap
      }
    }
    
    console.log(`[DELETE SALE] Sale details:`, {
      water_name,
      capacity,
      jerrycans_sold,
      purchase_id,
      sale_type: actualSaleType,
      water_bottle_item_id
    });
    
    // Get current stock BEFORE restoration
    const [stockBefore] = await pool.query(
      'SELECT * FROM water_jerrycans WHERE water_name = ? AND capacity = ?',
      [water_name, capacity]
    );
    console.log(`[DELETE SALE] Stock BEFORE restoration:`, stockBefore);
    
    // RESTORE STOCK based on sale_type
    switch (actualSaleType) {
      case 'water_only': // AMAZI + ICUPA (customer took filled water + bottle)
        console.log(`[DELETE SALE] AMAZI + ICUPA: Restoring ${jerrycans_sold} to FILLED stock ONLY`);
        await restoreToStock(water_name, capacity, jerrycans_sold, 'filled');
        break;
        
      case 'water_with_exchange': // AMAZI (customer brought bottle, took water, left empty)
        console.log(`[DELETE SALE] AMAZI: Restoring ${jerrycans_sold} to FILLED stock AND removing EMPTY stock we gained`);
        
        // Remove the empty stock we gained from the original sale
        const [emptyRows] = await pool.query(
          'SELECT id, quantity FROM water_jerrycans WHERE water_name = ? AND capacity = ? AND status = "empty" LIMIT 1',
          [water_name, capacity]
        );
        
        if (emptyRows.length > 0) {
          const currentEmptyQty = emptyRows[0].quantity;
          if (currentEmptyQty <= jerrycans_sold) {
            console.log(`[DELETE SALE] Removing empty stock record (qty ${currentEmptyQty} <= ${jerrycans_sold})`);
            await pool.query('DELETE FROM water_jerrycans WHERE id = ?', [emptyRows[0].id]);
          } else {
            console.log(`[DELETE SALE] Reducing empty stock by ${jerrycans_sold} (removing gained empties)`);
            await pool.query(
              'UPDATE water_jerrycans SET quantity = quantity - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
              [jerrycans_sold, emptyRows[0].id]
            );
          }
        }
        
        // Restore the filled stock
        await restoreToStock(water_name, capacity, jerrycans_sold, 'filled');
        break;
        
      case 'bottle_only': // ICUPA (customer took empty bottles only)
        console.log(`[DELETE SALE] ICUPA: Restoring ${jerrycans_sold} to EMPTY stock`);
        await restoreToStock(water_name, capacity, jerrycans_sold, 'empty');
        break;
        
      default:
        console.log(`[DELETE SALE] Unknown sale_type: ${actualSaleType}, using legacy logic`);
        // Fallback to legacy logic
        if (includes_bottle && !customer_brings_bottle) {
          await restoreToStock(water_name, capacity, jerrycans_sold, 'filled');
        } else {
          await restoreToStock(water_name, capacity, jerrycans_sold, 'filled');
        }
    }
    
    // RESTORE water_bottle_items stock — use water_bottle_item_id if set, else find by water_name+capacity
    let wbiId = water_bottle_item_id;
    if (!wbiId) {
      const [wbiRows] = await pool.query(
        'SELECT id FROM water_bottle_items WHERE water_name = ? AND CAST(capacity_liters AS UNSIGNED) = ? LIMIT 1',
        [water_name, parseInt(capacity)]
      );
      console.log(`[DELETE SALE] wbi lookup: water_name=${water_name}, capacity=${capacity}, found:`, wbiRows);
      if (wbiRows.length > 0) wbiId = wbiRows[0].id;
    }
    if (wbiId) {
      console.log(`[DELETE SALE] Restoring water_bottle_items ID: ${wbiId}, type: ${actualSaleType}`);
      switch (actualSaleType) {
        case 'water_only':
          await pool.query(
            'UPDATE water_bottle_items SET filled_stock = filled_stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [jerrycans_sold, wbiId]
          );
          console.log(`[DELETE SALE] AMAZI+ICUPA: filled_stock +${jerrycans_sold}`);
          break;
        case 'water_with_exchange':
          await pool.query(
            'UPDATE water_bottle_items SET filled_stock = filled_stock + ?, empty_stock = GREATEST(0, empty_stock - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [jerrycans_sold, jerrycans_sold, wbiId]
          );
          console.log(`[DELETE SALE] AMAZI: filled_stock +${jerrycans_sold}, empty_stock -${jerrycans_sold}`);
          break;
        case 'bottle_only':
          await pool.query(
            'UPDATE water_bottle_items SET empty_stock = empty_stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [jerrycans_sold, wbiId]
          );
          console.log(`[DELETE SALE] ICUPA: empty_stock +${jerrycans_sold}`);
          break;
      }
    } else {
      console.log(`[DELETE SALE] WARNING: No water_bottle_items record found for ${water_name} ${capacity}L`);
    }

    // Get current stock AFTER restoration
    const [stockAfter] = await pool.query(
      'SELECT * FROM water_jerrycans WHERE water_name = ? AND capacity = ?',
      [water_name, capacity]
    );
    console.log(`[DELETE SALE] Stock AFTER restoration:`, stockAfter);
    
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
      purchase_updated: purchase_id ? true : false,
      sale_type: actualSaleType
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// BULK DELETE water sales - Enhanced with proper stock restoration
router.delete('/sales/bulk', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const { sale_ids } = req.body;
    
    if (!sale_ids || !Array.isArray(sale_ids) || sale_ids.length === 0) {
      return res.status(400).json({ error: 'sale_ids array is required' });
    }
    
    console.log(`[BULK DELETE] Starting bulk delete for ${sale_ids.length} sales:`, sale_ids);
    
    const results = [];
    let successCount = 0;
    let failedCount = 0;
    
    // Process each sale individually to ensure proper stock restoration
    for (const saleId of sale_ids) {
      try {
        // Get sale details
        const [saleRows] = await pool.query('SELECT * FROM water_sales WHERE id = ?', [saleId]);
        
        if (saleRows.length === 0) {
          results.push({ id: saleId, success: false, error: 'Sale not found' });
          failedCount++;
          continue;
        }
        
        const sale = saleRows[0];
        const { 
          water_name, 
          capacity, 
          jerrycans_sold, 
          purchase_id, 
          sale_type,
          includes_bottle, 
          customer_brings_bottle,
          water_bottle_item_id,
          water_price,
          bottle_price_sold
        } = sale;
        
        // Derive sale_type if not set (for old records)
        let actualSaleType = sale_type;
        if (!actualSaleType) {
          if (!includes_bottle) {
            actualSaleType = 'water_with_exchange'; // AMAZI: no bottle involved
          } else if (includes_bottle && !customer_brings_bottle && parseFloat(water_price || 0) === 0) {
            actualSaleType = 'bottle_only'; // ICUPA: has bottle, no water price
          } else if (includes_bottle && !customer_brings_bottle) {
            actualSaleType = 'water_only'; // AMAZI + ICUPA: has bottle + water price
          } else {
            actualSaleType = 'water_with_exchange'; // AMAZI swap
          }
        }
        
        console.log(`[BULK DELETE] Processing sale ${saleId} - type: ${actualSaleType}, qty: ${jerrycans_sold}, water_bottle_item_id: ${water_bottle_item_id}`);
        
        // RESTORE STOCK based on sale_type
        switch (actualSaleType) {
          case 'water_only': // AMAZI + ICUPA (customer took filled water + bottle)
            await restoreToStock(water_name, capacity, jerrycans_sold, 'filled');
            break;
            
          case 'water_with_exchange': // AMAZI (customer brought bottle, took water, left empty)
            // Remove the empty stock we gained from the original sale
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
            
            // Restore the filled stock
            await restoreToStock(water_name, capacity, jerrycans_sold, 'filled');
            break;
            
          case 'bottle_only': // ICUPA (customer took empty bottles only)
            await restoreToStock(water_name, capacity, jerrycans_sold, 'empty');
            break;
            
          default:
            // Fallback to legacy logic
            await restoreToStock(water_name, capacity, jerrycans_sold, 'filled');
        }
        
        // RESTORE water_bottle_items stock — use water_bottle_item_id if set, else find by water_name+capacity
        let wbiId = water_bottle_item_id;
        if (!wbiId) {
          const [wbiRows] = await pool.query(
            'SELECT id FROM water_bottle_items WHERE water_name = ? AND CAST(capacity_liters AS UNSIGNED) = ? LIMIT 1',
            [water_name, parseInt(capacity)]
          );
          console.log(`[BULK DELETE] wbi lookup: water_name=${water_name}, capacity=${capacity}, found:`, wbiRows);
          if (wbiRows.length > 0) wbiId = wbiRows[0].id;
        }
        if (wbiId) {
          console.log(`[BULK DELETE] Restoring water_bottle_items ID: ${wbiId}, type: ${actualSaleType}`);
          switch (actualSaleType) {
            case 'water_only':
              await pool.query(
                'UPDATE water_bottle_items SET filled_stock = filled_stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [jerrycans_sold, wbiId]
              );
              console.log(`[BULK DELETE] AMAZI+ICUPA: filled_stock +${jerrycans_sold}`);
              break;
            case 'water_with_exchange':
              await pool.query(
                'UPDATE water_bottle_items SET filled_stock = filled_stock + ?, empty_stock = GREATEST(0, empty_stock - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [jerrycans_sold, jerrycans_sold, wbiId]
              );
              console.log(`[BULK DELETE] AMAZI: filled_stock +${jerrycans_sold}, empty_stock -${jerrycans_sold}`);
              break;
            case 'bottle_only':
              await pool.query(
                'UPDATE water_bottle_items SET empty_stock = empty_stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [jerrycans_sold, wbiId]
              );
              console.log(`[BULK DELETE] ICUPA: empty_stock +${jerrycans_sold}`);
              break;
          }
        } else {
          console.log(`[BULK DELETE] WARNING: No water_bottle_items record found for ${water_name} ${capacity}L`);
        }
        
        // UPDATE PURCHASE RECORD IF purchase_id EXISTS
        if (purchase_id) {
          await pool.query(
            'UPDATE water_additions SET jerrycans_added = jerrycans_added + ?, total_liters = total_liters + (? * ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [jerrycans_sold, jerrycans_sold, capacity, purchase_id]
          );
        }
        
        // Delete the sale
        await pool.query('DELETE FROM water_sales WHERE id = ?', [saleId]);
        
        if (userId) {
          await logActivity({
            userId: parseInt(userId),
            actionType: 'delete',
            entityType: 'water_sale',
            entityId: parseInt(saleId),
            entityName: `Water Sale #${saleId}`,
            description: `yasibiye igurisha amazi #${saleId} (yagaruriye ${jerrycans_sold} jerrycans - ${actualSaleType})`,
            metadata: { 
              jerrycans_sold, 
              sale_type: actualSaleType,
              water_name,
              capacity,
              purchase_id
            }
          });
        }
        
        results.push({ 
          id: saleId, 
          success: true, 
          restored_jerrycans: jerrycans_sold,
          sale_type: actualSaleType 
        });
        successCount++;
        
      } catch (saleError) {
        console.error(`[BULK DELETE] Error deleting sale ${saleId}:`, saleError);
        results.push({ id: saleId, success: false, error: saleError.message });
        failedCount++;
      }
    }
    
    console.log(`[BULK DELETE] Completed: ${successCount} success, ${failedCount} failed`);
    
    res.json({ 
      success: true, 
      message: `Bulk delete completed: ${successCount} deleted, ${failedCount} failed`,
      total_processed: sale_ids.length,
      success_count: successCount,
      failed_count: failedCount,
      results
    });
    
  } catch (error) {
    console.error('[BULK DELETE] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Helper function to restore water to stock
async function restoreToStock(water_name, capacity, quantity, status) {
  console.log(`[restoreToStock] Restoring ${quantity} ${status} bottles for ${water_name} ${capacity}L`);
  
  const [stockRows] = await pool.query(
    'SELECT id, quantity FROM water_jerrycans WHERE water_name = ? AND capacity = ? AND status = ? LIMIT 1',
    [water_name, capacity, status]
  );
  
  console.log(`[restoreToStock] Existing stock found:`, stockRows);
  
  if (stockRows.length > 0) {
    // Update existing stock
    const newQty = stockRows[0].quantity + quantity;
    console.log(`[restoreToStock] Updating existing stock ID ${stockRows[0].id}: ${stockRows[0].quantity} + ${quantity} = ${newQty}`);
    await pool.query(
      'UPDATE water_jerrycans SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [quantity, stockRows[0].id]
    );
  } else {
    // Create new stock record with unique serial_number
    const uniqueSerial = `STOCK-${water_name}-${capacity}L-${status}-${Date.now()}`;
    console.log(`[restoreToStock] Creating new stock record with serial: ${uniqueSerial}`);
    await pool.query(
      'INSERT INTO water_jerrycans (water_name, capacity, status, quantity, serial_number, created_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
      [water_name, capacity, status, quantity, uniqueSerial]
    );
  }
  
  console.log(`[restoreToStock] Done restoring stock`);
}
// GET water additions (with optional period, start_date, end_date)
router.get('/additions', async (req, res) => {
  try {
    const { period, start_date, end_date, water_name } = req.query;
    let dateFilter = '';
    let waterNameFilter = '';
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
    // Note: 'all' period means no date filter
    
    if (water_name) {
      waterNameFilter = 'water_name = ?';
    }
    
    let query = 'SELECT id, water_name, status, jerrycans_added, liters_per_jerrycan, total_liters, buying_price_per_jerrycan, selling_price_per_jerrycan, COALESCE(bottle_price, 0) as bottle_price, total_buying_cost AS total_cost, total_selling_price, expected_profit, supplier_name, date, COALESCE(purchase_type, IF(status=\'empty\',\'bottles\',\'water\')) as purchase_type, water_bottle_item_id, COALESCE(empty_bottles_returned, 0) as empty_bottles_returned, created_at, updated_at FROM water_additions';
    
    // Combine filters
    const filters = [];
    if (dateFilter) filters.push(dateFilter);
    if (waterNameFilter) filters.push(waterNameFilter);
    
    if (filters.length > 0) {
      query += ' WHERE ' + filters.join(' AND ');
      if (water_name) {
        params.push(water_name);
      }
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
      date,
      purchase_type,
      water_bottle_item_id,
      empty_bottles_returned = 0
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
      'INSERT INTO water_additions (water_name, status, jerrycans_added, liters_per_jerrycan, total_liters, buying_price_per_jerrycan, selling_price_per_jerrycan, bottle_price, total_buying_cost, total_selling_price, expected_profit, supplier_name, date, purchase_type, water_bottle_item_id, empty_bottles_returned) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [wName, jerrycanStatus, jerrycans_added, liters_per_jerrycan, total_liters, buying, selling, bottlePrice, total_buying_cost, total_selling_price, expected_profit, supplier_name || '', dateVal, purchase_type || (jerrycanStatus === 'empty' ? 'bottles' : 'water'), water_bottle_item_id || null, empty_bottles_returned || 0]
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
    // Check for ANY existing stock record for this product (regardless of reference_id)
    const [existingRows] = await pool.query(
      'SELECT id, quantity FROM water_jerrycans WHERE water_name = ? AND capacity = ? AND status = ? LIMIT 1',
      [wName, liters_per_jerrycan, jerrycanStatus]
    );
    
    if (existingRows.length > 0) {
      // Update existing record's quantity and prices
      await pool.query(
        'UPDATE water_jerrycans SET quantity = quantity + ?, selling_price = ?, bottle_price = ?, bottle_health = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [jerrycans_added, selling, bottlePrice, health, existingRows[0].id]
      );
    } else {
      // Insert new record with unique serial_number (using timestamp to avoid duplicates)
      const uniqueSerial = `STOCK-${wName}-${liters_per_jerrycan}L-${jerrycanStatus}-${Date.now()}`;
      await pool.query(
        'INSERT INTO water_jerrycans (water_name, capacity, status, serial_number, selling_price, bottle_price, bottle_health, quantity, reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
        [wName, liters_per_jerrycan, jerrycanStatus, uniqueSerial, selling, bottlePrice, health, jerrycans_added, purchaseId]
      );
    }

    // 4. Update water_bottle_items stock to reflect the purchase
    console.log(`[purchase] water_bottle_item_id=${water_bottle_item_id}, jerrycanStatus=${jerrycanStatus}, jerrycans_added=${jerrycans_added}, empty_bottles_returned=${empty_bottles_returned}`);
    if (water_bottle_item_id) {
      if (jerrycanStatus === 'filled') {
        // Kugura Amazi: filled_stock increases, empty_stock decreases by returned amount
        const [upd] = await pool.query(
          `UPDATE water_bottle_items SET
            filled_stock = filled_stock + ?,
            empty_stock = GREATEST(0, empty_stock - ?),
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
          [jerrycans_added, empty_bottles_returned || 0, water_bottle_item_id]
        );
        console.log(`[purchase] filled water → filled_stock +${jerrycans_added}, empty_stock -${empty_bottles_returned || 0}, affectedRows=${upd.affectedRows}`);
      } else {
        // Kugura Amacupa: empty_stock increases
        const [upd] = await pool.query(
          `UPDATE water_bottle_items SET
            empty_stock = empty_stock + ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?`,
          [jerrycans_added, water_bottle_item_id]
        );
        console.log(`[purchase] empty bottles → empty_stock +${jerrycans_added}, affectedRows=${upd.affectedRows}`);
      }
    } else {
      console.log(`[purchase] WARNING: no water_bottle_item_id sent — water_bottle_items NOT updated`);
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
    
    // NOTE: When EDITING a purchase, we do NOT adjust empty bottle stock
    // Empty bottle adjustments only happen during CREATE (swap with distributor)
    // Editing is for correcting mistakes, not for reversing distributor swaps
    
    // Update the corresponding stock (filled or empty based on status)
    // First try by reference_id, then by water_name + capacity + status
    const [stockRows] = await pool.query(
      'SELECT id, quantity FROM water_jerrycans WHERE reference_id = ?',
      [id]
    );
    
    if (stockRows.length > 0) {
      // Update existing stock by reference_id
      const newQty = stockRows[0].quantity + quantityDiff;
      if (newQty <= 0) {
        await pool.query('DELETE FROM water_jerrycans WHERE id = ?', [stockRows[0].id]);
      } else {
        await pool.query(
          'UPDATE water_jerrycans SET quantity = ?, selling_price = ?, bottle_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [newQty, selling, bottlePrice, stockRows[0].id]
        );
      }
    } else {
      // No reference_id match - find by water_name + capacity + status
      const [matchingStock] = await pool.query(
        'SELECT id, quantity FROM water_jerrycans WHERE water_name = ? AND capacity = ? AND status = ? LIMIT 1',
        [waterName, liters_per_jerrycan, jerrycanStatus]
      );
      
      if (matchingStock.length > 0) {
        const newQty = matchingStock[0].quantity + quantityDiff;
        if (newQty <= 0) {
          await pool.query('DELETE FROM water_jerrycans WHERE id = ?', [matchingStock[0].id]);
        } else {
          await pool.query(
            'UPDATE water_jerrycans SET quantity = ?, selling_price = ?, bottle_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [newQty, selling, bottlePrice, matchingStock[0].id]
          );
        }
      } else if (quantityDiff > 0) {
        // No existing stock found and we're adding - create new record
        const uniqueSerial = `STOCK-${waterName}-${liters_per_jerrycan}L-${jerrycanStatus}-${Date.now()}`;
        await pool.query(
          'INSERT INTO water_jerrycans (water_name, capacity, status, quantity, selling_price, bottle_price, serial_number, reference_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
          [waterName, liters_per_jerrycan, jerrycanStatus, quantityDiff, selling, bottlePrice, uniqueSerial, id]
        );
      }
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
    console.log(`[DELETE PURCHASE] Raw record:`, JSON.stringify(purchase));
    const { 
      water_name, 
      capacity, 
      status, 
      liters_per_jerrycan,
      selling_price_per_jerrycan,
      bottle_price,
      water_bottle_item_id,
      purchase_type,
      empty_bottles_returned
    } = purchase;
    console.log(`[DELETE PURCHASE] water_bottle_item_id=${water_bottle_item_id}, purchase_type=${purchase_type}, status=${status}, jerrycans_added=${purchase.jerrycans_added}, empty_bottles_returned=${empty_bottles_returned}`);
    
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
    
    // NOTE: When DELETING a purchase, we do NOT restore empty bottles
    // Deleting is for correcting mistakes, not for reversing distributor swaps
    // We simply remove the stock that was added by this purchase
    
    // Remove stock linked to this purchase
    // Method 1: Try to find and update by reference_id first
    const [refRows] = await pool.query('SELECT id, quantity FROM water_jerrycans WHERE reference_id = ?', [id]);
    
    if (refRows.length > 0) {
      // Stock record exists with this reference_id - delete it entirely
      await pool.query('DELETE FROM water_jerrycans WHERE reference_id = ?', [id]);
    } else {
      // No reference_id match - find by water_name + capacity + status and reduce quantity
      const [stockRows] = await pool.query(
        'SELECT id, quantity FROM water_jerrycans WHERE water_name = ? AND capacity = ? AND status = ? LIMIT 1',
        [water_name, liters_per_jerrycan, status]
      );
      
      if (stockRows.length > 0) {
        const newQty = stockRows[0].quantity - jerrycans_added;
        if (newQty <= 0) {
          await pool.query('DELETE FROM water_jerrycans WHERE id = ?', [stockRows[0].id]);
        } else {
          await pool.query('UPDATE water_jerrycans SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newQty, stockRows[0].id]);
        }
      }
    }
    
    // REVERSE water_bottle_items stock — exact reverse of POST /additions
    let wbiId = water_bottle_item_id;
    if (!wbiId) {
      const [wbiRows] = await pool.query(
        'SELECT id FROM water_bottle_items WHERE water_name = ? AND CAST(capacity_liters AS UNSIGNED) = ? LIMIT 1',
        [water_name, parseInt(liters_per_jerrycan || capacity)]
      );
      console.log(`[DELETE PURCHASE] Fallback lookup: water_name=${water_name}, capacity=${parseInt(liters_per_jerrycan || capacity)}, found:`, wbiRows);
      if (wbiRows.length > 0) wbiId = wbiRows[0].id;
    }
    if (wbiId) {
      // Get stock BEFORE update
      const [beforeStock] = await pool.query('SELECT filled_stock, empty_stock FROM water_bottle_items WHERE id = ?', [wbiId]);
      console.log(`[DELETE PURCHASE] BEFORE: item ${wbiId} - filled=${beforeStock[0]?.filled_stock}, empty=${beforeStock[0]?.empty_stock}`);
      
      const isBottlePurchase = purchase_type === 'bottles' || status === 'empty';
      console.log(`[DELETE PURCHASE] isBottlePurchase=${isBottlePurchase} (purchase_type=${purchase_type}, status=${status})`);
      
      if (isBottlePurchase) {
        // Kugura Amacupa reverse: empty_stock was increased, so decrease it back
        const [result] = await pool.query(
          'UPDATE water_bottle_items SET empty_stock = GREATEST(0, empty_stock - ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [jerrycans_added, wbiId]
        );
        console.log(`[DELETE PURCHASE] Bottles: empty_stock -${jerrycans_added} on item ${wbiId}, affectedRows=${result.affectedRows}`);
      } else {
        // Kugura Amazi reverse: filled_stock was increased AND empty_stock was decreased
        // So: filled_stock -qty, empty_stock +empty_bottles_returned
        const returned = parseInt(empty_bottles_returned) || jerrycans_added;
        const [result] = await pool.query(
          'UPDATE water_bottle_items SET filled_stock = GREATEST(0, filled_stock - ?), empty_stock = empty_stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [jerrycans_added, returned, wbiId]
        );
        console.log(`[DELETE PURCHASE] Water: filled_stock -${jerrycans_added}, empty_stock +${returned} on item ${wbiId}, affectedRows=${result.affectedRows}`);
      }
      
      // Get stock AFTER update
      const [afterStock] = await pool.query('SELECT filled_stock, empty_stock FROM water_bottle_items WHERE id = ?', [wbiId]);
      console.log(`[DELETE PURCHASE] AFTER: item ${wbiId} - filled=${afterStock[0]?.filled_stock}, empty=${afterStock[0]?.empty_stock}`);
    } else {
      console.log(`[DELETE PURCHASE] WARNING: No water_bottle_items found for ${water_name} ${liters_per_jerrycan}L`);
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

// RESET stock when all data is deleted
router.post('/reset-stock', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    
    // Check if there are any sales or purchases
    const [salesCount] = await pool.query('SELECT COUNT(*) as count FROM water_sales');
    const [purchasesCount] = await pool.query('SELECT COUNT(*) as count FROM water_additions');
    
    if (salesCount[0].count > 0 || purchasesCount[0].count > 0) {
      return res.status(400).json({ 
        error: 'Cannot reset stock. There are still sales or purchases in the system.' 
      });
    }
    
    // Delete all stock records
    await pool.query('DELETE FROM water_jerrycans');
    
    if (userId) {
      await logActivity({
        userId: parseInt(userId),
        actionType: 'delete',
        entityType: 'stock_reset',
        entityId: 0,
        entityName: 'Stock Reset',
        description: 'Yakomitse stock zose ku zero',
        metadata: {}
      });
    }
    
    res.json({ 
      success: true, 
      message: 'Stock has been reset to zero' 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// BOTTLE ITEMS (Product Catalog) ROUTES
// ============================================

// GET all bottle items
router.get('/bottle-items', async (req, res) => {
  try {
    // Create table if it doesn't exist
    await pool.query(`
      CREATE TABLE  water_bottle_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        water_name VARCHAR(255) NOT NULL,
        capacity_liters DECIMAL(10, 2) NOT NULL,
        bottle_type VARCHAR(100) DEFAULT 'Jerrycan',
        buying_price DECIMAL(10, 2) DEFAULT 0,
        selling_price DECIMAL(10, 2) DEFAULT 0,
        bottle_cost DECIMAL(10, 2) DEFAULT 0,
        min_stock INT DEFAULT 5,
        status ENUM('active', 'inactive') DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // Get bottle items with calculated stock from water_jerrycans
    const [items] = await pool.query(`
      SELECT 
        bi.*,
        COALESCE(SUM(CASE WHEN wj.status = 'filled' THEN wj.quantity ELSE 0 END), 0) as filled_stock,
        COALESCE(SUM(CASE WHEN wj.status = 'empty' THEN wj.quantity ELSE 0 END), 0) as empty_stock,
        COALESCE(SUM(wj.quantity), 0) as total_stock,
        COALESCE(SUM(CASE WHEN wj.status = 'filled' THEN wj.quantity ELSE 0 END), 0) * (bi.buying_price + bi.bottle_cost) as total_investment
      FROM water_bottle_items bi
      LEFT JOIN water_jerrycans wj ON wj.water_name = bi.water_name AND wj.capacity = bi.capacity_liters
      GROUP BY bi.id
      ORDER BY bi.created_at DESC
    `);

    res.json({ success: true, data: items });
  } catch (error) {
    console.error('Error fetching bottle items:', error);
    res.status(500).json({ error: error.message });
  }
});

// CREATE bottle item
router.post('/bottle-items', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const {
      water_name,
      capacity_liters,
      bottle_type = 'Jerrycan',
      buying_price = 0,
      selling_price = 0,
      bottle_cost = 0,
      min_stock = 5,
      status = 'active'
    } = req.body;

    if (!water_name || !capacity_liters) {
      return res.status(400).json({ error: 'Water name and capacity are required' });
    }

    // Create table if it doesn't exist
    await pool.query(`
      CREATE TABLE  water_bottle_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        water_name VARCHAR(255) NOT NULL,
        capacity_liters DECIMAL(10, 2) NOT NULL,
        bottle_type VARCHAR(100) DEFAULT 'Jerrycan',
        buying_price DECIMAL(10, 2) DEFAULT 0,
        selling_price DECIMAL(10, 2) DEFAULT 0,
        bottle_cost DECIMAL(10, 2) DEFAULT 0,
        min_stock INT DEFAULT 5,
        status ENUM('active', 'inactive') DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    const [result] = await pool.query(
      'INSERT INTO water_bottle_items (water_name, capacity_liters, bottle_type, buying_price, selling_price, bottle_cost, min_stock, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [water_name, capacity_liters, bottle_type, buying_price, selling_price, bottle_cost, min_stock, status]
    );

    if (userId) {
      await logActivity({
        userId: parseInt(userId),
        actionType: 'create',
        entityType: 'water_bottle_item',
        entityId: result.insertId,
        entityName: `${water_name} ${capacity_liters}L`,
        description: `yongeremo ubwoko bw'amacupa: ${water_name} ${capacity_liters}L`,
        metadata: { water_name, capacity_liters, bottle_type }
      });
    }

    res.json({
      success: true,
      data: {
        id: result.insertId,
        water_name,
        capacity_liters,
        bottle_type,
        buying_price,
        selling_price,
        bottle_cost,
        min_stock,
        status
      }
    });
  } catch (error) {
    console.error('Error creating bottle item:', error);
    res.status(500).json({ error: error.message });
  }
});

// UPDATE bottle item
router.put('/bottle-items/:id', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const { id } = req.params;
    const {
      water_name,
      capacity_liters,
      bottle_type,
      buying_price,
      selling_price,
      bottle_cost,
      min_stock,
      status
    } = req.body;

    if (!water_name || !capacity_liters) {
      return res.status(400).json({ error: 'Water name and capacity are required' });
    }

    await pool.query(
      'UPDATE water_bottle_items SET water_name = ?, capacity_liters = ?, bottle_type = ?, buying_price = ?, selling_price = ?, bottle_cost = ?, min_stock = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [water_name, capacity_liters, bottle_type, buying_price, selling_price, bottle_cost, min_stock, status, id]
    );

    if (userId) {
      await logActivity({
        userId: parseInt(userId),
        actionType: 'update',
        entityType: 'water_bottle_item',
        entityId: parseInt(id),
        entityName: `${water_name} ${capacity_liters}L`,
        description: `yahuje ubwoko bw'amacupa: ${water_name} ${capacity_liters}L`,
        metadata: { water_name, capacity_liters, bottle_type }
      });
    }

    res.json({ success: true, message: 'Bottle item updated successfully' });
  } catch (error) {
    console.error('Error updating bottle item:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE bottle item
router.delete('/bottle-items/:id', async (req, res) => {
  try {
    const userId = req.headers['x-user-id'];
    const { id } = req.params;

    // Get item details before deleting
    const [items] = await pool.query('SELECT * FROM water_bottle_items WHERE id = ?', [id]);
    
    if (items.length === 0) {
      return res.status(404).json({ error: 'Bottle item not found' });
    }

    const item = items[0];

    await pool.query('DELETE FROM water_bottle_items WHERE id = ?', [id]);

    if (userId) {
      await logActivity({
        userId: parseInt(userId),
        actionType: 'delete',
        entityType: 'water_bottle_item',
        entityId: parseInt(id),
        entityName: `${item.water_name} ${item.capacity_liters}L`,
        description: `yasibe ubwoko bw'amacupa: ${item.water_name} ${item.capacity_liters}L`,
        metadata: { water_name: item.water_name, capacity_liters: item.capacity_liters }
      });
    }

    res.json({ success: true, message: 'Bottle item deleted successfully' });
  } catch (error) {
    console.error('Error deleting bottle item:', error);
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