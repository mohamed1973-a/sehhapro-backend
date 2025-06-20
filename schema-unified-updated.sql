-- Healthcare Platform Unified Schema (Updated)
-- Optimized for PostgreSQL with telemedicine support

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Function for automatic timestamp updates
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Roles table (defines user roles)
CREATE TABLE IF NOT EXISTS roles (
  id SERIAL PRIMARY KEY,
  name VARCHAR(50) UNIQUE NOT NULL
);

-- Users table (core user data)
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  role_id INT NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Clinics table (healthcare facilities)
CREATE TABLE IF NOT EXISTS clinics (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  address TEXT NOT NULL,
  phone VARCHAR(20),
  email VARCHAR(255),
  description TEXT,
  type VARCHAR(20) NOT NULL DEFAULT 'parent' CHECK (type IN ('parent', 'child', 'main', 'lab')),
  parent_id INTEGER REFERENCES clinics(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Doctor-Clinic associations (many-to-many)
CREATE TABLE IF NOT EXISTS doctor_clinics (
  doctor_id INT REFERENCES users(id) ON DELETE CASCADE,
  clinic_id INT REFERENCES clinics(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (doctor_id, clinic_id)
);

-- Lab-Clinic associations (many-to-many)
CREATE TABLE IF NOT EXISTS lab_clinics (
  lab_id INT REFERENCES users(id) ON DELETE CASCADE,
  clinic_id INT REFERENCES clinics(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (lab_id, clinic_id)
);

-- Nurse-Clinic associations (many-to-many)
CREATE TABLE IF NOT EXISTS nurse_clinics (
  id SERIAL PRIMARY KEY,
  nurse_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(nurse_id, clinic_id)
);

-- Patient-Clinic associations (many-to-many with primary flag)
CREATE TABLE IF NOT EXISTS patient_clinics (
  patient_id INT REFERENCES users(id) ON DELETE CASCADE,
  clinic_id INT REFERENCES clinics(id) ON DELETE CASCADE,
  is_primary BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (patient_id, clinic_id)
);

-- Admin-Clinic associations (many-to-many with primary flag)
CREATE TABLE IF NOT EXISTS admin_clinics (
  id SERIAL PRIMARY KEY,
  admin_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clinic_id INT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  is_primary BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(admin_id, clinic_id)
);

-- Doctor Portfolios (doctor professional details)
CREATE TABLE IF NOT EXISTS doctor_portfolios (
  doctor_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  specialty VARCHAR(100),
  sub_specialization VARCHAR(100),
  years_experience INT,
  education JSONB,
  certifications JSONB,
  languages JSONB,
  awards JSONB,
  research_publications JSONB,
  profile_picture VARCHAR(255),
  consultation_fee DECIMAL(10, 2),
  available_for_telemedicine BOOLEAN DEFAULT FALSE,
  bio TEXT,
  license_number VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Nurse Portfolios (nurse professional details)
CREATE TABLE IF NOT EXISTS nurse_portfolios (
  nurse_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  specialty VARCHAR(100),
  years_experience INT,
  education JSONB,
  certifications JSONB,
  languages JSONB,
  profile_picture VARCHAR(255),
  bio TEXT,
  license_number VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Patient Medical Profiles (patient health data)
CREATE TABLE IF NOT EXISTS patient_medical_profiles (
  patient_id INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  medical_history JSONB,
  family_history JSONB,
  allergies JSONB,
  medications JSONB,
  immunizations JSONB,
  surgical_history JSONB,
  lifestyle_factors JSONB,
  vitals JSONB,
  last_physical_exam DATE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Unified Availability Slots (for all provider types)
-- UPDATED: clinic_id now allows NULL for telemedicine appointments
CREATE TABLE IF NOT EXISTS availability_slots (
  id SERIAL PRIMARY KEY,
  provider_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider_type VARCHAR(20) NOT NULL CHECK (provider_type IN ('doctor', 'lab', 'nurse')),
  clinic_id INT REFERENCES clinics(id) ON DELETE CASCADE, -- NULL allowed for telemedicine
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP NOT NULL,
  is_available BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  CONSTRAINT valid_time_range CHECK (start_time < end_time)
);

-- Add comment to document the clinic_id change
COMMENT ON COLUMN availability_slots.clinic_id IS 'Clinic ID for in-person appointments. NULL for telemedicine appointments.';

-- Appointments (patient bookings)
CREATE TABLE IF NOT EXISTS appointments (
  id SERIAL PRIMARY KEY,
  patient_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doctor_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clinic_id INT REFERENCES clinics(id) ON DELETE CASCADE, -- Can be NULL for telemedicine
  slot_id INT REFERENCES availability_slots(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'in-progress', 'completed', 'cancelled', 'pending')),
  type VARCHAR(20) NOT NULL CHECK (type IN ('in-person', 'telemedicine')),
  reason TEXT,
  check_in_time TIMESTAMP,
  check_out_time TIMESTAMP,
  feedback_submitted BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Refresh Tokens (for authentication)
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Prescriptions (with status and refills)
CREATE TABLE IF NOT EXISTS prescriptions (
  id SERIAL PRIMARY KEY,
  patient_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doctor_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clinic_id INT REFERENCES clinics(id) ON DELETE CASCADE, -- Can be NULL for telemedicine prescriptions
  appointment_id INT REFERENCES appointments(id) ON DELETE SET NULL,
  medication JSONB NOT NULL, -- { name, dosage, frequency, duration }
  refills INTEGER DEFAULT 0,
  notes TEXT,
  status VARCHAR(50) DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled', 'refill_requested')),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Lab Requests
CREATE TABLE IF NOT EXISTS lab_requests (
  id SERIAL PRIMARY KEY,
  patient_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doctor_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lab_clinic_id INT NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
  appointment_id INT REFERENCES appointments(id) ON DELETE SET NULL,
  test_type VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'in-progress', 'completed', 'cancelled')),
  result_file TEXT, -- Path to uploaded file
  result_notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Lab Results (separate from requests for better data organization)
CREATE TABLE IF NOT EXISTS lab_results (
  id SERIAL PRIMARY KEY,
  request_id INT NOT NULL REFERENCES lab_requests(id) ON DELETE CASCADE,
  result_data JSONB,
  result_file TEXT,
  result_notes TEXT,
  reviewed_by INT REFERENCES users(id),
  reviewed_at TIMESTAMP,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'abnormal', 'critical')),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Medical Records
CREATE TABLE IF NOT EXISTS medical_records (
  id SERIAL PRIMARY KEY,
  patient_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doctor_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  clinic_id INT REFERENCES clinics(id) ON DELETE CASCADE, -- Can be NULL for telemedicine records
  appointment_id INT REFERENCES appointments(id) ON DELETE SET NULL,
  record_type VARCHAR(100) NOT NULL,
  diagnosis TEXT,
  treatment TEXT,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Doctor Feedback
CREATE TABLE IF NOT EXISTS doctor_feedback (
  id SERIAL PRIMARY KEY,
  appointment_id INT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  patient_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  doctor_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating INT CHECK (rating BETWEEN 1 AND 5),
  comments TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(appointment_id, patient_id)
);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  type VARCHAR(100) NOT NULL,
  priority VARCHAR(50) DEFAULT 'normal',
  read BOOLEAN DEFAULT FALSE,
  ref_id INT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Notifications Config
CREATE TABLE IF NOT EXISTS notifications_config (
  id SERIAL PRIMARY KEY,
  type VARCHAR(100) NOT NULL UNIQUE,
  sms_enabled BOOLEAN DEFAULT FALSE,
  sms_template TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Telemedicine Sessions
CREATE TABLE IF NOT EXISTS telemedicine_sessions (
  id SERIAL PRIMARY KEY,
  appointment_id INT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  start_time TIMESTAMP,
  end_time TIMESTAMP,
  video_link TEXT,
  status VARCHAR(50) DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in-progress', 'completed', 'cancelled')),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Add triggers for updated_at timestamps
DROP TRIGGER IF EXISTS update_users_modtime ON users;
CREATE TRIGGER update_users_modtime
BEFORE UPDATE ON users
FOR EACH ROW EXECUTE FUNCTION update_modified_column();

DROP TRIGGER IF EXISTS update_clinics_modtime ON clinics;
CREATE TRIGGER update_clinics_modtime
BEFORE UPDATE ON clinics
FOR EACH ROW EXECUTE FUNCTION update_modified_column();

DROP TRIGGER IF EXISTS update_availability_slots_modtime ON availability_slots;
CREATE TRIGGER update_availability_slots_modtime
BEFORE UPDATE ON availability_slots
FOR EACH ROW EXECUTE FUNCTION update_modified_column();

DROP TRIGGER IF EXISTS update_appointments_modtime ON appointments;
CREATE TRIGGER update_appointments_modtime
BEFORE UPDATE ON appointments
FOR EACH ROW EXECUTE FUNCTION update_modified_column();

DROP TRIGGER IF EXISTS update_prescriptions_modtime ON prescriptions;
CREATE TRIGGER update_prescriptions_modtime
BEFORE UPDATE ON prescriptions
FOR EACH ROW EXECUTE FUNCTION update_modified_column();

DROP TRIGGER IF EXISTS update_lab_requests_modtime ON lab_requests;
CREATE TRIGGER update_lab_requests_modtime
BEFORE UPDATE ON lab_requests
FOR EACH ROW EXECUTE FUNCTION update_modified_column();

DROP TRIGGER IF EXISTS update_patient_medical_profiles_modtime ON patient_medical_profiles;
CREATE TRIGGER update_patient_medical_profiles_modtime
BEFORE UPDATE ON patient_medical_profiles
FOR EACH ROW EXECUTE FUNCTION update_modified_column();

DROP TRIGGER IF EXISTS update_doctor_portfolios_modtime ON doctor_portfolios;
CREATE TRIGGER update_doctor_portfolios_modtime
BEFORE UPDATE ON doctor_portfolios
FOR EACH ROW EXECUTE FUNCTION update_modified_column();

DROP TRIGGER IF EXISTS update_nurse_portfolios_modtime ON nurse_portfolios;
CREATE TRIGGER update_nurse_portfolios_modtime
BEFORE UPDATE ON nurse_portfolios
FOR EACH ROW EXECUTE FUNCTION update_modified_column();

DROP TRIGGER IF EXISTS update_admin_clinics_modtime ON admin_clinics;
CREATE TRIGGER update_admin_clinics_modtime
BEFORE UPDATE ON admin_clinics
FOR EACH ROW EXECUTE FUNCTION update_modified_column();

DROP TRIGGER IF EXISTS update_telemedicine_sessions_modtime ON telemedicine_sessions;
CREATE TRIGGER update_telemedicine_sessions_modtime
BEFORE UPDATE ON telemedicine_sessions
FOR EACH ROW EXECUTE FUNCTION update_modified_column();

DROP TRIGGER IF EXISTS update_lab_results_modtime ON lab_results;
CREATE TRIGGER update_lab_results_modtime
BEFORE UPDATE ON lab_results
FOR EACH ROW EXECUTE FUNCTION update_modified_column();

-- Create indexes for performance (updated for telemedicine support)
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role_id ON users(role_id);
CREATE INDEX IF NOT EXISTS idx_appointments_patient_id ON appointments(patient_id);
CREATE INDEX IF NOT EXISTS idx_appointments_doctor_id ON appointments(doctor_id);
CREATE INDEX IF NOT EXISTS idx_appointments_slot_id ON appointments(slot_id);
CREATE INDEX IF NOT EXISTS idx_appointments_status ON appointments(status);
CREATE INDEX IF NOT EXISTS idx_availability_slots_provider_id ON availability_slots(provider_id);
CREATE INDEX IF NOT EXISTS idx_availability_slots_provider_type ON availability_slots(provider_type);
-- Updated: Conditional index for in-person appointments only
CREATE INDEX IF NOT EXISTS idx_availability_slots_clinic_id ON availability_slots(clinic_id) WHERE clinic_id IS NOT NULL;
-- New: Index for telemedicine appointments
CREATE INDEX IF NOT EXISTS idx_availability_slots_telemedicine ON availability_slots(provider_id, provider_type, start_time) WHERE clinic_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_availability_slots_start_time ON availability_slots(start_time);
CREATE INDEX IF NOT EXISTS idx_availability_slots_is_available ON availability_slots(is_available);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token);
CREATE INDEX IF NOT EXISTS idx_clinics_type ON clinics(type);
CREATE INDEX IF NOT EXISTS idx_prescriptions_patient_id ON prescriptions(patient_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_doctor_id ON prescriptions(doctor_id);
CREATE INDEX IF NOT EXISTS idx_prescriptions_status ON prescriptions(status);
CREATE INDEX IF NOT EXISTS idx_lab_requests_patient_id ON lab_requests(patient_id);
CREATE INDEX IF NOT EXISTS idx_lab_requests_doctor_id ON lab_requests(doctor_id);
CREATE INDEX IF NOT EXISTS idx_lab_requests_status ON lab_requests(status);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);
CREATE INDEX IF NOT EXISTS idx_medical_records_patient_id ON medical_records(patient_id);
CREATE INDEX IF NOT EXISTS idx_medical_records_doctor_id ON medical_records(doctor_id);
CREATE INDEX IF NOT EXISTS idx_telemedicine_sessions_appointment_id ON telemedicine_sessions(appointment_id);
CREATE INDEX IF NOT EXISTS idx_telemedicine_sessions_status ON telemedicine_sessions(status);
CREATE INDEX IF NOT EXISTS idx_doctor_clinics_doctor_id ON doctor_clinics(doctor_id);
CREATE INDEX IF NOT EXISTS idx_doctor_clinics_clinic_id ON doctor_clinics(clinic_id);
CREATE INDEX IF NOT EXISTS idx_lab_clinics_lab_id ON lab_clinics(lab_id);
CREATE INDEX IF NOT EXISTS idx_lab_clinics_clinic_id ON lab_clinics(clinic_id);
CREATE INDEX IF NOT EXISTS idx_nurse_clinics_nurse_id ON nurse_clinics(nurse_id);
CREATE INDEX IF NOT EXISTS idx_nurse_clinics_clinic_id ON nurse_clinics(clinic_id);
CREATE INDEX IF NOT EXISTS idx_patient_clinics_patient_id ON patient_clinics(patient_id);
CREATE INDEX IF NOT EXISTS idx_patient_clinics_clinic_id ON patient_clinics(clinic_id);
CREATE INDEX IF NOT EXISTS idx_admin_clinics_admin_id ON admin_clinics(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_clinics_clinic_id ON admin_clinics(clinic_id);
CREATE INDEX IF NOT EXISTS idx_admin_clinics_is_primary ON admin_clinics(is_primary);
CREATE INDEX IF NOT EXISTS idx_lab_results_request_id ON lab_results(request_id);
CREATE INDEX IF NOT EXISTS idx_lab_results_status ON lab_results(status);

-- Initial Data (Roles)
INSERT INTO roles (name) VALUES
  ('patient'),
  ('doctor'),
  ('nurse'),
  ('lab'),
  ('clinic_admin'),
  ('lab_admin'),
  ('platform_admin')
ON CONFLICT (name) DO NOTHING;

-- Default notification types
INSERT INTO notifications_config (type, sms_enabled, sms_template) VALUES
  ('appointment_reminder', TRUE, 'Reminder: You have an appointment on {date}'),
  ('appointment_booked', TRUE, 'New appointment booked: {message}'),
  ('appointment_cancelled', TRUE, 'Appointment cancelled: {message}'),
  ('lab_result', TRUE, 'Your lab results are ready'),
  ('prescription_refill', TRUE, 'Your prescription refill request has been processed'),
  ('system_message', FALSE, '{message}'),
  ('appointment_scheduled', TRUE, '{message}'),
  ('lab_request', FALSE, '{message}')
ON CONFLICT (type) DO NOTHING;

-- Book Appointment function (updated for telemedicine support)
CREATE OR REPLACE FUNCTION book_appointment(
  p_patient_id INT,
  p_doctor_id INT,
  p_clinic_id INT, -- Can be NULL for telemedicine
  p_start_time TIMESTAMP,
  p_type VARCHAR,
  p_reason TEXT
) RETURNS INT AS $$
DECLARE
  v_slot_id INT;
  v_appointment_id INT;
BEGIN
  -- Find an available slot
  SELECT id INTO v_slot_id
  FROM availability_slots
  WHERE provider_id = p_doctor_id
    AND provider_type = 'doctor'
    AND (clinic_id = p_clinic_id OR (clinic_id IS NULL AND p_clinic_id IS NULL))
    AND start_time = p_start_time
    AND is_available = TRUE
  LIMIT 1;

  IF v_slot_id IS NULL THEN
    RETURN -1; -- No available slot
  END IF;

  -- Mark slot as unavailable
  UPDATE availability_slots SET is_available = FALSE WHERE id = v_slot_id;

  -- Create the appointment
  INSERT INTO appointments (patient_id, doctor_id, clinic_id, slot_id, type, reason)
  VALUES (p_patient_id, p_doctor_id, p_clinic_id, v_slot_id, p_type, p_reason)
  RETURNING id INTO v_appointment_id;

  RETURN v_appointment_id;
EXCEPTION
  WHEN OTHERS THEN
    RETURN -1;
END;
$$ LANGUAGE plpgsql;
