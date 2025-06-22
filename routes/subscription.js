const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { protect, role } = require('../middleware/auth');

// Get all subscription plans (public)
router.get('/plans', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM subscription_plans ORDER BY price ASC');
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get a single subscription plan by ID (public)
router.get('/plans/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM subscription_plans WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Plan not found' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create a new subscription plan (platform admin)
router.post('/plans', protect, role(['platform_admin']), async (req, res) => {
  try {
    const { name, description, price, currency, billing_cycle, features, limits, is_active, is_popular } = req.body;
    const result = await pool.query(
      `INSERT INTO subscription_plans (name, description, price, currency, billing_cycle, features, limits, is_active, is_popular)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [name, description, price, currency, billing_cycle, features, limits, is_active, is_popular]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Update a subscription plan (platform admin)
router.put('/plans/:id', protect, role(['platform_admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, price, currency, billing_cycle, features, limits, is_active, is_popular } = req.body;
    const result = await pool.query(
      `UPDATE subscription_plans SET name=$1, description=$2, price=$3, currency=$4, billing_cycle=$5, features=$6, limits=$7, is_active=$8, is_popular=$9, updated_at=NOW() WHERE id=$10 RETURNING *`,
      [name, description, price, currency, billing_cycle, features, limits, is_active, is_popular, id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete a subscription plan (platform admin)
router.delete('/plans/:id', protect, role(['platform_admin']), async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM subscription_plans WHERE id=$1', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get all clinic subscriptions (platform admin)
router.get('/subscriptions', protect, role(['platform_admin']), async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM clinic_subscriptions');
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get a clinic's subscription (clinic admin)
router.get('/my-subscription', protect, role(['clinic_admin']), async (req, res) => {
  try {
    const clinicId = req.user.clinic_id;
    const result = await pool.query('SELECT * FROM clinic_subscriptions WHERE clinic_id=$1 ORDER BY created_at DESC LIMIT 1', [clinicId]);
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create/upgrade a clinic subscription (clinic admin)
router.post('/my-subscription', protect, role(['clinic_admin']), async (req, res) => {
  try {
    const clinicId = req.user.clinic_id;
    const { plan_id, payment_method_id, total_amount, discount_percentage, discount_amount, end_date, next_billing_date, auto_renew } = req.body;
    const result = await pool.query(
      `INSERT INTO clinic_subscriptions (clinic_id, plan_id, status, start_date, end_date, next_billing_date, auto_renew, payment_method_id, discount_percentage, discount_amount, total_amount)
       VALUES ($1, $2, 'active', NOW(), $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [clinicId, plan_id, end_date, next_billing_date, auto_renew, payment_method_id, discount_percentage, discount_amount, total_amount]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Cancel a clinic subscription (clinic admin)
router.post('/my-subscription/cancel', protect, role(['clinic_admin']), async (req, res) => {
  try {
    const clinicId = req.user.clinic_id;
    await pool.query(
      `UPDATE clinic_subscriptions SET status='cancelled', updated_at=NOW() WHERE clinic_id=$1 AND status='active'`,
      [clinicId]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get all payments for a clinic (clinic admin)
router.get('/my-payments', protect, role(['clinic_admin']), async (req, res) => {
  try {
    const clinicId = req.user.clinic_id;
    const result = await pool.query('SELECT * FROM subscription_payments WHERE subscription_id IN (SELECT id FROM clinic_subscriptions WHERE clinic_id=$1)', [clinicId]);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get all invoices for a clinic (clinic admin)
router.get('/my-invoices', protect, role(['clinic_admin']), async (req, res) => {
  try {
    const clinicId = req.user.clinic_id;
    const result = await pool.query('SELECT * FROM subscription_invoices WHERE subscription_id IN (SELECT id FROM clinic_subscriptions WHERE clinic_id=$1)', [clinicId]);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get usage for a clinic (clinic admin)
router.get('/my-usage', protect, role(['clinic_admin']), async (req, res) => {
  try {
    const clinicId = req.user.clinic_id;
    const result = await pool.query('SELECT * FROM subscription_usage WHERE subscription_id IN (SELECT id FROM clinic_subscriptions WHERE clinic_id=$1)', [clinicId]);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router; 