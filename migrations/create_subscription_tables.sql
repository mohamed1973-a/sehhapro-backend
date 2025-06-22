-- Insert default subscription plans
INSERT INTO subscription_plans (name, description, price, currency, billing_cycle, features, limits, is_active, is_popular) VALUES
(
  'Basic',
  'Perfect for small clinics just getting started',
  15000.00,
  'DZD',
  'monthly',
  '[
    {"name": "Patient Management", "description": "Manage patient records and profiles", "is_included": true},
    {"name": "Appointment Scheduling", "description": "Schedule and manage appointments", "is_included": true},
    {"name": "Telemedicine", "description": "Video consultations with patients", "is_included": false},
    {"name": "Lab Integration", "description": "Connect with laboratory systems", "is_included": false},
    {"name": "Analytics Dashboard", "description": "Advanced reporting and analytics", "is_included": false},
    {"name": "API Access", "description": "Programmatic access to platform features", "is_included": false},
    {"name": "Custom Branding", "description": "Customize platform with clinic branding", "is_included": false},
    {"name": "Priority Support", "description": "24/7 priority customer support", "is_included": false}
  ]',
  '{
    "max_doctors": 3,
    "max_patients": 500,
    "max_appointments_per_month": 1000,
    "max_storage_gb": 5,
    "telemedicine_enabled": false,
    "lab_integration_enabled": false,
    "analytics_enabled": false,
    "api_access_enabled": false,
    "custom_branding_enabled": false,
    "priority_support": false
  }',
  true,
  false
),
(
  'Professional',
  'Ideal for growing clinics with advanced needs',
  35000.00,
  'DZD',
  'monthly',
  '[
    {"name": "Patient Management", "description": "Manage patient records and profiles", "is_included": true},
    {"name": "Appointment Scheduling", "description": "Schedule and manage appointments", "is_included": true},
    {"name": "Telemedicine", "description": "Video consultations with patients", "is_included": true},
    {"name": "Lab Integration", "description": "Connect with laboratory systems", "is_included": true},
    {"name": "Analytics Dashboard", "description": "Advanced reporting and analytics", "is_included": true},
    {"name": "API Access", "description": "Programmatic access to platform features", "is_included": false},
    {"name": "Custom Branding", "description": "Customize platform with clinic branding", "is_included": false},
    {"name": "Priority Support", "description": "24/7 priority customer support", "is_included": true}
  ]',
  '{
    "max_doctors": 10,
    "max_patients": 2000,
    "max_appointments_per_month": 5000,
    "max_storage_gb": 25,
    "telemedicine_enabled": true,
    "lab_integration_enabled": true,
    "analytics_enabled": true,
    "api_access_enabled": false,
    "custom_branding_enabled": false,
    "priority_support": true
  }',
  true,
  true
),
(
  'Enterprise',
  'Complete solution for large healthcare organizations',
  75000.00,
  'DZD',
  'monthly',
  '[
    {"name": "Patient Management", "description": "Manage patient records and profiles", "is_included": true},
    {"name": "Appointment Scheduling", "description": "Schedule and manage appointments", "is_included": true},
    {"name": "Telemedicine", "description": "Video consultations with patients", "is_included": true},
    {"name": "Lab Integration", "description": "Connect with laboratory systems", "is_included": true},
    {"name": "Analytics Dashboard", "description": "Advanced reporting and analytics", "is_included": true},
    {"name": "API Access", "description": "Programmatic access to platform features", "is_included": true},
    {"name": "Custom Branding", "description": "Customize platform with clinic branding", "is_included": true},
    {"name": "Priority Support", "description": "24/7 priority customer support", "is_included": true}
  ]',
  '{
    "max_doctors": -1,
    "max_patients": -1,
    "max_appointments_per_month": -1,
    "max_storage_gb": 100,
    "telemedicine_enabled": true,
    "lab_integration_enabled": true,
    "analytics_enabled": true,
    "api_access_enabled": true,
    "custom_branding_enabled": true,
    "priority_support": true
  }',
  true,
  false
); 