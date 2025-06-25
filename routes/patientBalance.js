const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { pool } = require('../config/database');

// Get patient balance and transaction history
router.get('/balance', protect, async (req, res) => {
  try {
    const patientId = req.user.id;
    
    // Get current balance
    const balanceQuery = await pool.query(
      'SELECT balance FROM users WHERE id = $1',
      [patientId]
    );
    
    // Get recent transactions
    const transactionsQuery = await pool.query(
      `SELECT 
        pt.id,
        pt.type,
        pt.amount,
        pt.description,
        pt.payment_method,
        pt.reference_number,
        pt.status,
        pt.created_at,
        a.id as appointment_id,
        ts.id as session_id
      FROM patient_transactions pt
      LEFT JOIN appointments a ON pt.related_appointment_id = a.id
      LEFT JOIN telemedicine_sessions ts ON pt.related_telemedicine_session_id = ts.id
      WHERE pt.patient_id = $1
      ORDER BY pt.created_at DESC
      LIMIT 20`,
      [patientId]
    );
    
    res.json({
      success: true,
      data: {
        balance: balanceQuery.rows[0]?.balance || 0,
        transactions: transactionsQuery.rows
      }
    });
  } catch (error) {
    console.error('Error fetching balance:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch balance'
    });
  }
});

// Get patient payment methods
router.get('/payment-methods', protect, async (req, res) => {
  try {
    const patientId = req.user.id;
    
    const query = await pool.query(
      'SELECT * FROM patient_payment_methods WHERE patient_id = $1 AND is_active = true ORDER BY is_default DESC, created_at DESC',
      [patientId]
    );
    
    res.json({
      success: true,
      data: query.rows
    });
  } catch (error) {
    console.error('Error fetching payment methods:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payment methods'
    });
  }
});

// Add payment method
router.post('/payment-methods', protect, async (req, res) => {
  try {
    const patientId = req.user.id;
    const { type, account_number, account_name, bank_name, branch_code, is_default } = req.body;
    
    // Validate payment method type
    const validTypes = ['baridi_mob', 'edahabia', 'bank_transfer', 'cash_deposit'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment method type'
      });
    }
    
    // If setting as default, unset other defaults
    if (is_default) {
      await pool.query(
        'UPDATE patient_payment_methods SET is_default = false WHERE patient_id = $1',
        [patientId]
      );
    }
    
    const query = await pool.query(
      `INSERT INTO patient_payment_methods 
       (patient_id, type, account_number, account_name, bank_name, branch_code, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [patientId, type, account_number, account_name, bank_name, branch_code, is_default || false]
    );
    
    res.json({
      success: true,
      data: query.rows[0],
      message: 'Payment method added successfully'
    });
  } catch (error) {
    console.error('Error adding payment method:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add payment method'
    });
  }
});

// Update payment method
router.put('/payment-methods/:id', protect, async (req, res) => {
  try {
    const patientId = req.user.id;
    const methodId = req.params.id;
    const { type, account_number, account_name, bank_name, branch_code, is_default } = req.body;
    
    // Check if payment method belongs to patient
    const existingQuery = await pool.query(
      'SELECT * FROM patient_payment_methods WHERE id = $1 AND patient_id = $2',
      [methodId, patientId]
    );
    
    if (existingQuery.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Payment method not found'
      });
    }
    
    // If setting as default, unset other defaults
    if (is_default) {
      await pool.query(
        'UPDATE patient_payment_methods SET is_default = false WHERE patient_id = $1 AND id != $2',
        [patientId, methodId]
      );
    }
    
    const query = await pool.query(
      `UPDATE patient_payment_methods 
       SET type = $1, account_number = $2, account_name = $3, bank_name = $4, branch_code = $5, is_default = $6, updated_at = NOW()
       WHERE id = $7 AND patient_id = $8
       RETURNING *`,
      [type, account_number, account_name, bank_name, branch_code, is_default, methodId, patientId]
    );
    
    res.json({
      success: true,
      data: query.rows[0],
      message: 'Payment method updated successfully'
    });
  } catch (error) {
    console.error('Error updating payment method:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update payment method'
    });
  }
});

// Delete payment method
router.delete('/payment-methods/:id', protect, async (req, res) => {
  try {
    const patientId = req.user.id;
    const methodId = req.params.id;
    
    const query = await pool.query(
      'UPDATE patient_payment_methods SET is_active = false WHERE id = $1 AND patient_id = $2 RETURNING *',
      [methodId, patientId]
    );
    
    if (query.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Payment method not found'
      });
    }
    
    res.json({
      success: true,
      message: 'Payment method deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting payment method:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete payment method'
    });
  }
});

// Add money to balance
router.post('/deposit', protect, async (req, res) => {
  try {
    const patientId = req.user.id;
    const { amount, payment_method, reference_number, description } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid amount'
      });
    }
    
    // Start transaction
    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Create transaction record
      const transactionQuery = await client.query(
        `INSERT INTO patient_transactions 
         (patient_id, type, amount, description, payment_method, reference_number, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [patientId, 'deposit', amount, description || 'Balance deposit', payment_method, reference_number, 'completed']
      );
      
      // Update patient balance
      await client.query(
        'UPDATE users SET balance = balance + $1 WHERE id = $2',
        [amount, patientId]
      );
      
      await client.query('COMMIT');
      
      res.json({
        success: true,
        data: transactionQuery.rows[0],
        message: 'Deposit successful'
      });
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error processing deposit:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process deposit'
    });
  }
});

// Get transaction history with pagination
router.get('/transactions', protect, async (req, res) => {
  try {
    const patientId = req.user.id;
    const { page = 1, limit = 10, type } = req.query;
    const offset = (page - 1) * limit;
    
    let whereClause = 'WHERE pt.patient_id = $1';
    let params = [patientId];
    let paramIndex = 2;
    
    if (type) {
      whereClause += ` AND pt.type = $${paramIndex}`;
      params.push(type);
      paramIndex++;
    }
    
    const query = await pool.query(
      `SELECT 
        pt.id,
        pt.type,
        pt.amount,
        pt.description,
        pt.payment_method,
        pt.reference_number,
        pt.status,
        pt.created_at,
        a.id as appointment_id,
        ts.id as session_id
      FROM patient_transactions pt
      LEFT JOIN appointments a ON pt.related_appointment_id = a.id
      LEFT JOIN telemedicine_sessions ts ON pt.related_telemedicine_session_id = ts.id
      ${whereClause}
      ORDER BY pt.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, limit, offset]
    );
    
    // Get total count
    const countQuery = await pool.query(
      `SELECT COUNT(*) FROM patient_transactions pt ${whereClause}`,
      params
    );
    
    res.json({
      success: true,
      data: {
        transactions: query.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: parseInt(countQuery.rows[0].count),
          pages: Math.ceil(countQuery.rows[0].count / limit)
        }
      }
    });
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transactions'
    });
  }
});

module.exports = router; 