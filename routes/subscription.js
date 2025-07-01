const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { protect, role } = require('../middleware/auth');

// Get all subscription plans (public)
router.get('/plans', async (req, res) => {
  try {
    let result = await pool.query('SELECT * FROM subscription_plans ORDER BY price ASC');
    
    // If no plans exist, create default Algerian market plans
    if (result.rows.length === 0) {
      console.log('No subscription plans found, creating default Algerian market plans...');
      
      const defaultPlans = [
        {
          name: 'Student Plan',
          name_ar: 'خطة الطلاب',
          description: 'Perfect for medical students and residents',
          description_ar: 'مثالية للطلاب والمقيمين الطبيين',
          price: 3000,
          currency: 'DZD',
          billing_cycle: 'monthly',
          features: JSON.stringify([
            { name: 'Patient Management', description: 'Manage patient records', is_included: true },
            { name: 'Appointment Scheduling', description: 'Schedule appointments', is_included: true },
            { name: 'Basic Analytics', description: 'Simple reporting', is_included: true },
            { name: 'Telemedicine', description: 'Video consultations', is_included: false },
            { name: 'Lab Integration', description: 'Laboratory connectivity', is_included: false },
            { name: 'Priority Support', description: '24/7 support', is_included: false }
          ]),
          limits: JSON.stringify({
            max_doctors: 1,
            max_patients: 50,
            max_appointments_per_month: 100,
            max_storage_gb: 1,
            telemedicine_enabled: false,
            lab_integration_enabled: false,
            trial_days: 30
          }),
          is_active: true,
          is_popular: false
        },
        {
          name: 'Basic Plan',
          name_ar: 'الخطة الأساسية',
          description: 'Ideal for small clinics and individual practitioners',
          description_ar: 'مثالية للعيادات الصغيرة والممارسين الأفراد',
          price: 12000,
          currency: 'DZD',
          billing_cycle: 'monthly',
          features: JSON.stringify([
            { name: 'Patient Management', description: 'Manage patient records', is_included: true },
            { name: 'Appointment Scheduling', description: 'Schedule appointments', is_included: true },
            { name: 'Basic Analytics', description: 'Simple reporting', is_included: true },
            { name: 'Email Support', description: 'Email customer support', is_included: true },
            { name: 'Telemedicine', description: 'Video consultations', is_included: false },
            { name: 'Lab Integration', description: 'Laboratory connectivity', is_included: false },
            { name: 'Priority Support', description: '24/7 support', is_included: false }
          ]),
          limits: JSON.stringify({
            max_doctors: 2,
            max_patients: 300,
            max_appointments_per_month: 500,
            max_storage_gb: 3,
            telemedicine_enabled: false,
            lab_integration_enabled: false,
            trial_days: 14
          }),
          is_active: true,
          is_popular: false
        },
        {
          name: 'Professional Plan',
          name_ar: 'الخطة الاحترافية',
          description: 'Perfect for growing medical practices',
          description_ar: 'مثالية للممارسات الطبية المتنامية',
          price: 25000,
          currency: 'DZD',
          billing_cycle: 'monthly',
          features: JSON.stringify([
            { name: 'Patient Management', description: 'Manage patient records', is_included: true },
            { name: 'Appointment Scheduling', description: 'Schedule appointments', is_included: true },
            { name: 'Advanced Analytics', description: 'Comprehensive reporting', is_included: true },
            { name: 'Telemedicine', description: 'Video consultations', is_included: true },
            { name: 'Lab Integration', description: 'Laboratory connectivity', is_included: true },
            { name: 'SMS Notifications', description: 'Patient notifications', is_included: true },
            { name: 'Priority Support', description: '24/7 support', is_included: true },
            { name: 'Automatic Backup', description: 'Data backup', is_included: true }
          ]),
          limits: JSON.stringify({
            max_doctors: 8,
            max_patients: 1500,
            max_appointments_per_month: 2500,
            max_storage_gb: 15,
            telemedicine_enabled: true,
            lab_integration_enabled: true,
            sms_limit: 500,
            trial_days: 14,
            setup_fee: 5000
          }),
          is_active: true,
          is_popular: true
        },
        {
          name: 'Enterprise Plan',
          name_ar: 'الخطة المؤسسية',
          description: 'For large healthcare organizations',
          description_ar: 'للمؤسسات الصحية الكبيرة',
          price: 45000,
          currency: 'DZD',
          billing_cycle: 'monthly',
          features: JSON.stringify([
            { name: 'Patient Management', description: 'Manage patient records', is_included: true },
            { name: 'Appointment Scheduling', description: 'Schedule appointments', is_included: true },
            { name: 'Advanced Analytics', description: 'Comprehensive reporting', is_included: true },
            { name: 'Telemedicine', description: 'Video consultations', is_included: true },
            { name: 'Lab Integration', description: 'Laboratory connectivity', is_included: true },
            { name: 'Unlimited SMS', description: 'Patient notifications', is_included: true },
            { name: 'Custom Branding', description: 'Clinic branding', is_included: true },
            { name: 'API Access', description: 'Programmatic access', is_included: true },
            { name: 'Dedicated Support', description: '24/7 dedicated support', is_included: true },
            { name: 'Custom Training', description: 'Staff training', is_included: true }
          ]),
          limits: JSON.stringify({
            max_doctors: -1, // Unlimited
            max_patients: -1, // Unlimited
            max_appointments_per_month: -1, // Unlimited
            max_storage_gb: 100,
            telemedicine_enabled: true,
            lab_integration_enabled: true,
            sms_limit: -1, // Unlimited
            trial_days: 30,
            setup_fee: 15000
          }),
          is_active: true,
          is_popular: false
        }
      ];

      for (const plan of defaultPlans) {
        await pool.query(
          `INSERT INTO subscription_plans (name, name_ar, description, description_ar, price, currency, billing_cycle, features, limits, is_active, is_popular)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [plan.name, plan.name_ar, plan.description, plan.description_ar, plan.price, plan.currency, plan.billing_cycle, plan.features, plan.limits, plan.is_active, plan.is_popular]
        );
      }
      
      // Fetch the newly created plans
      result = await pool.query('SELECT * FROM subscription_plans ORDER BY price ASC');
      console.log(`Created ${result.rows.length} default subscription plans`);
    }
    
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('Error fetching subscription plans:', err);
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

// Get a clinic's subscriptions (clinic admin)
router.get('/my-subscription', protect, role(['clinic_admin']), async (req, res) => {
  try {
    const clinicId = req.user.clinic_id;
    const result = await pool.query('SELECT * FROM clinic_subscriptions WHERE clinic_id=$1 ORDER BY created_at DESC', [clinicId]);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Create/upgrade a clinic subscription (clinic admin)
router.post('/my-subscription', protect, role(['clinic_admin']), async (req, res) => {
  try {
    let clinicId = req.user.clinic_id;
    if (!clinicId) {
      // Fallback: fetch from admin_clinics join table
      const adminResult = await pool.query(
        'SELECT clinic_id FROM admin_clinics WHERE admin_id = $1 LIMIT 1',
        [req.user.id]
      );
      if (adminResult.rows.length > 0) {
        clinicId = adminResult.rows[0].clinic_id;
      } else {
        return res.status(400).json({ success: false, error: 'No clinic associated with this admin.' });
      }
    }
    const { plan_id, payment_method_id, total_amount, discount_percentage, discount_amount, end_date, next_billing_date, auto_renew } = req.body;
    const result = await pool.query(
      `INSERT INTO clinic_subscriptions (clinic_id, plan_id, status, start_date, end_date, next_billing_date, auto_renew, payment_method_id, discount_percentage, discount_amount, total_amount)
       VALUES ($1, $2, 'pending', NOW(), $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [clinicId, plan_id, end_date, next_billing_date, auto_renew, payment_method_id, discount_percentage, discount_amount, total_amount]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('Error in /my-subscription POST:', err.stack || err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// New: Activate a clinic subscription (platform admin)
router.post('/subscriptions/:id/activate', protect, role(['platform_admin']), async (req, res) => {
  try {
    const { id } = req.params;
    // Only activate if currently pending
    const result = await pool.query(
      `UPDATE clinic_subscriptions SET status='active', updated_at=NOW() WHERE id=$1 AND status='pending' RETURNING *`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'Subscription not found or not pending' });
    }
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

// Get available features for the current clinic (free and premium)
router.get('/my-features', protect, role(['clinic_admin']), async (req, res) => {
  try {
    // Define free features (always available)
    const free_features = [
      { name: 'Basic Dashboard', key: 'basic_dashboard', description: 'Access to the dashboard overview' },
      { name: 'Profile Management', key: 'profile_management', description: 'Manage your clinic and user profile' },
      { name: 'Support', key: 'support', description: 'Access to support resources' }
    ];

    // Get the clinic's active subscription
    const clinicId = req.user.clinic_id;
    const subResult = await pool.query(
      `SELECT * FROM clinic_subscriptions WHERE clinic_id=$1 AND status='active' ORDER BY created_at DESC LIMIT 1`,
      [clinicId]
    );
    let premium_features = [];
    if (subResult.rows.length > 0) {
      // Get plan features
      const planId = subResult.rows[0].plan_id;
      const planResult = await pool.query('SELECT features FROM subscription_plans WHERE id=$1', [planId]);
      if (planResult.rows.length > 0) {
        premium_features = JSON.parse(planResult.rows[0].features || '[]').filter(f => f.is_included);
      }
    }
    res.json({ success: true, free_features, premium_features });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Clinic admin requests subscription cancellation (sets status to 'cancel_requested')
router.post('/my-subscription/cancel-request', protect, role(['clinic_admin']), async (req, res) => {
  try {
    const clinicId = req.user.clinic_id;
    const result = await pool.query(
      `UPDATE clinic_subscriptions SET status='cancel_requested', updated_at=NOW() WHERE clinic_id=$1 AND status='active' RETURNING *`,
      [clinicId]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'No active subscription to cancel.' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Platform admin approves cancellation (sets status to 'cancelled')
router.post('/subscriptions/:id/cancel', protect, role(['platform_admin']), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE clinic_subscriptions SET status='cancelled', updated_at=NOW() WHERE id=$1 AND status='cancel_requested' RETURNING *`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'No cancel request found for this subscription.' });
    }
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Delete a clinic subscription (platform admin)
router.delete('/subscriptions/:id', protect, role(['platform_admin']), async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM clinic_subscriptions WHERE id=$1', [id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
