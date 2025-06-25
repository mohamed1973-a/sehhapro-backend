-- =====================================================
-- PATIENT BALANCE SYSTEM MIGRATION
-- Adds internal balance system for Algerian payment methods
-- =====================================================

-- Add balance column to users table (for patients)
ALTER TABLE users ADD COLUMN IF NOT EXISTS balance DECIMAL(10,2) DEFAULT 0.00;

-- Create patient transactions table
CREATE TABLE IF NOT EXISTS patient_transactions (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL CHECK (type IN ('deposit', 'withdrawal', 'payment', 'refund')),
  amount DECIMAL(10,2) NOT NULL,
  description TEXT,
  payment_method VARCHAR(50),
  reference_number VARCHAR(100),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
  related_appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  related_telemedicine_session_id INTEGER REFERENCES telemedicine_sessions(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create patient payment methods table
CREATE TABLE IF NOT EXISTS patient_payment_methods (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL CHECK (type IN ('baridi_mob', 'edahabia', 'bank_transfer', 'cash_deposit')),
  account_number VARCHAR(100),
  account_name VARCHAR(100),
  bank_name VARCHAR(100),
  branch_code VARCHAR(20),
  is_default BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_patient_transactions_patient_id ON patient_transactions(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_transactions_type ON patient_transactions(type);
CREATE INDEX IF NOT EXISTS idx_patient_transactions_status ON patient_transactions(status);
CREATE INDEX IF NOT EXISTS idx_patient_transactions_created_at ON patient_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_patient_transactions_appointment_id ON patient_transactions(related_appointment_id);
CREATE INDEX IF NOT EXISTS idx_patient_transactions_telemedicine_id ON patient_transactions(related_telemedicine_session_id);

CREATE INDEX IF NOT EXISTS idx_patient_payment_methods_patient_id ON patient_payment_methods(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_payment_methods_type ON patient_payment_methods(type);
CREATE INDEX IF NOT EXISTS idx_patient_payment_methods_default ON patient_payment_methods(is_default);

-- Drop existing triggers if they exist
DROP TRIGGER IF EXISTS update_patient_transactions_modtime ON patient_transactions;
DROP TRIGGER IF EXISTS update_patient_payment_methods_modtime ON patient_payment_methods;

-- Add triggers for updated_at
CREATE TRIGGER update_patient_transactions_modtime 
  BEFORE UPDATE ON patient_transactions 
  FOR EACH ROW EXECUTE FUNCTION update_modified_column();

CREATE TRIGGER update_patient_payment_methods_modtime 
  BEFORE UPDATE ON patient_payment_methods 
  FOR EACH ROW EXECUTE FUNCTION update_modified_column();

-- Function to update patient balance
CREATE OR REPLACE FUNCTION update_patient_balance(
  p_patient_id INTEGER,
  p_amount DECIMAL(10,2),
  p_transaction_type VARCHAR(20)
) RETURNS BOOLEAN AS $$
DECLARE
  current_balance DECIMAL(10,2);
BEGIN
  -- Get current balance
  SELECT balance INTO current_balance FROM users WHERE id = p_patient_id;
  
  -- Update balance based on transaction type
  IF p_transaction_type = 'deposit' OR p_transaction_type = 'refund' THEN
    UPDATE users SET balance = balance + p_amount WHERE id = p_patient_id;
  ELSIF p_transaction_type = 'withdrawal' OR p_transaction_type = 'payment' THEN
    -- Check if sufficient balance
    IF current_balance >= p_amount THEN
      UPDATE users SET balance = balance - p_amount WHERE id = p_patient_id;
    ELSE
      RETURN FALSE; -- Insufficient balance
    END IF;
  END IF;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Insert default payment method types (only if they don't exist)
INSERT INTO patient_payment_methods (patient_id, type, account_name, is_default, is_active) 
SELECT 
  u.id,
  'baridi_mob',
  u.full_name,
  TRUE,
  TRUE
FROM users u 
WHERE u.role_id = (SELECT id FROM roles WHERE name = 'patient')
  AND NOT EXISTS (
    SELECT 1 FROM patient_payment_methods ppm WHERE ppm.patient_id = u.id
  );

-- Add some sample data for testing (only if it doesn't exist)
INSERT INTO patient_transactions (patient_id, type, amount, description, payment_method, status)
SELECT 
  u.id,
  'deposit',
  5000.00,
  'Initial balance deposit',
  'baridi_mob',
  'completed'
FROM users u 
WHERE u.role_id = (SELECT id FROM roles WHERE name = 'patient')
  AND u.id IN (1, 2, 3) -- Sample patients
  AND NOT EXISTS (
    SELECT 1 FROM patient_transactions pt WHERE pt.patient_id = u.id
  );

-- Update sample patient balances (only if balance is 0 or NULL)
UPDATE users 
SET balance = 5000.00 
WHERE id IN (1, 2, 3) 
  AND role_id = (SELECT id FROM roles WHERE name = 'patient')
  AND (balance IS NULL OR balance = 0); 