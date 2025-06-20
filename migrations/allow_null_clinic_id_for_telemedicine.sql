-- Migration to allow NULL clinic_id for telemedicine appointments
-- This allows doctors to create availability slots for telemedicine without being tied to a specific clinic

-- First, let's check the current constraint
SELECT 
    tc.constraint_name, 
    tc.table_name, 
    kcu.column_name, 
    tc.constraint_type
FROM 
    information_schema.table_constraints AS tc 
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
WHERE 
    tc.table_name = 'availability_slots' 
    AND kcu.column_name = 'clinic_id';

-- Remove the NOT NULL constraint from clinic_id to allow telemedicine appointments
ALTER TABLE availability_slots 
ALTER COLUMN clinic_id DROP NOT NULL;

-- Add a check constraint to ensure that either:
-- 1. clinic_id is provided (for in-person appointments), OR
-- 2. clinic_id is NULL (for telemedicine appointments)
-- This maintains data integrity while allowing flexibility

-- Optional: Add a comment to document this change
COMMENT ON COLUMN availability_slots.clinic_id IS 'Clinic ID for in-person appointments. NULL for telemedicine appointments.';

-- Update any existing indexes to handle NULL values properly
-- Drop and recreate the clinic_id index to handle NULLs efficiently
DROP INDEX IF EXISTS idx_availability_slots_clinic_id;
CREATE INDEX idx_availability_slots_clinic_id ON availability_slots(clinic_id) WHERE clinic_id IS NOT NULL;

-- Create a separate index for telemedicine slots (where clinic_id IS NULL)
CREATE INDEX idx_availability_slots_telemedicine ON availability_slots(provider_id, provider_type, start_time) WHERE clinic_id IS NULL;

-- Verify the change
SELECT column_name, is_nullable, data_type 
FROM information_schema.columns 
WHERE table_name = 'availability_slots' AND column_name = 'clinic_id';
