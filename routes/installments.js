const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');

// GET installments by debt ID
router.get('/debt/:debtId', async (req, res) => {
  try {
    const { debtId } = req.params;
    const [installments] = await pool.query(
      'SELECT * FROM debt_installments WHERE debt_id = ? ORDER BY payment_date DESC',
      [debtId]
    );
    res.json({ success: true, data: installments });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// CREATE installment
router.post('/', async (req, res) => {
  try {
    const { debtId, amount, paymentDate, notes = '' } = req.body;
    if (!debtId) return res.status(400).json({ error: 'Debt ID is required' });
    if (amount === undefined) return res.status(400).json({ error: 'Amount is required' });
    if (!paymentDate) return res.status(400).json({ error: 'Payment date is required' });

    // Get debt amount and current total paid
    const [[debtRow]] = await pool.query(
      'SELECT amount, description FROM debts WHERE id = ?',
      [debtId]
    );
    const debt_amount = debtRow?.amount;

    // Calculate current total paid (before this installment)
    const [[{ current_total_paid }]] = await pool.query(
      'SELECT COALESCE(SUM(amount), 0) as current_total_paid FROM debt_installments WHERE debt_id = ?',
      [debtId]
    );

    // Calculate remaining balance
    const remaining_balance = debt_amount - current_total_paid;

    // Cap the installment amount at the remaining balance
    const capped_amount = Math.min(parseFloat(amount), remaining_balance);

    // Prevent overpayment
    if (capped_amount <= 0) {
      return res.status(400).json({ 
        error: 'This debt is already fully paid. No additional payment needed.',
        totalPaid: current_total_paid,
        debtAmount: debt_amount
      });
    }

    // Add installment with capped amount
    const [result] = await pool.query(
      'INSERT INTO debt_installments (debt_id, amount, payment_date, notes) VALUES (?, ?, ?, ?)',
      [debtId, capped_amount, paymentDate, notes || (capped_amount < amount ? `Payment capped at remaining balance (original: ${amount})` : '')]
    );

    // Calculate new total paid
    const total_paid = parseFloat(current_total_paid) + parseFloat(capped_amount);

    // Update debt status - use a small epsilon for floating point comparison
    const balance = debt_amount - total_paid;
    const newDebtStatus = balance <= 0.01 ? 'paid' : 'pending';
    
    console.log(`Debt ${debtId}: amount=${debt_amount}, total_paid=${total_paid}, balance=${balance}, status=${newDebtStatus}`);
    
    await pool.query(
      'UPDATE debts SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [newDebtStatus, debtId]
    );

    // If this debt came from a sale, sync the sale status
    const desc = (debtRow?.description || '').toString();
    const match = desc.match(/^Sale\s*#(\d+)$/i);
    if (match) {
      const saleId = parseInt(match[1]);
      if (!Number.isNaN(saleId)) {
        const newSaleStatus = total_paid >= debt_amount ? 'Paid' : 'Partial';
        await pool.query('UPDATE sales SET status = ? WHERE id = ?', [newSaleStatus, saleId]);
      }
    }

    res.json({
      success: true,
      data: {
        id: result.insertId,
        debtId,
        amount,
        paymentDate,
        notes,
        totalPaid: total_paid,
        isFullyPaid: total_paid >= debt_amount
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE installment
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Get installment to know debt_id
    const [installments] = await pool.query(
      'SELECT debt_id FROM debt_installments WHERE id = ?',
      [id]
    );
    if (installments.length === 0) {
      return res.status(404).json({ error: 'Installment not found' });
    }
    const debtId = installments[0].debt_id;

    // Delete installment
    await pool.query('DELETE FROM debt_installments WHERE id = ?', [id]);

    // Recalculate total paid
    const [[{ total_paid }]] = await pool.query(
      'SELECT COALESCE(SUM(amount), 0) as total_paid FROM debt_installments WHERE debt_id = ?',
      [debtId]
    );

    // Get debt amount + link to sale (if any)
    const [[debtRow]] = await pool.query(
      'SELECT amount, description FROM debts WHERE id = ?',
      [debtId]
    );
    const debt_amount = debtRow?.amount;

    // Update debt status
    const newStatus = total_paid >= debt_amount ? 'paid' : 'pending';
    await pool.query(
      'UPDATE debts SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [newStatus, debtId]
    );

    // If this debt came from a sale, sync the sale status
    const desc = (debtRow?.description || '').toString();
    const match = desc.match(/^Sale\s*#(\d+)$/i);
    if (match) {
      const saleId = parseInt(match[1]);
      if (!Number.isNaN(saleId)) {
        const newSaleStatus = total_paid >= debt_amount ? 'Paid' : 'Partial';
        await pool.query('UPDATE sales SET status = ? WHERE id = ?', [newSaleStatus, saleId]);
      }
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
