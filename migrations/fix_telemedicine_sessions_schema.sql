-- Fix telemedicine_sessions table schema
-- This migration ensures the table has the correct columns

-- First, check if the table exists and get its current structure
DO $$
DECLARE
    table_exists boolean;
    has_patient_id boolean;
    has_doctor_id boolean;
BEGIN
    -- Check if table exists
    SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'telemedicine_sessions'
    ) INTO table_exists;

    IF table_exists THEN
        -- Check if patient_id column exists
        SELECT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'telemedicine_sessions' AND column_name = 'patient_id'
        ) INTO has_patient_id;

        -- Check if doctor_id column exists
        SELECT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_name = 'telemedicine_sessions' AND column_name = 'doctor_id'
        ) INTO has_doctor_id;

        -- Add patient_id column if it doesn't exist
        IF NOT has_patient_id THEN
            ALTER TABLE telemedicine_sessions 
            ADD COLUMN patient_id INTEGER REFERENCES users(id);
            
            -- Update existing records to set patient_id from appointments
            UPDATE telemedicine_sessions ts
            SET patient_id = a.patient_id
            FROM appointments a
            WHERE ts.appointment_id = a.id;
            
            RAISE NOTICE 'Added patient_id column to telemedicine_sessions';
        END IF;

        -- Add doctor_id column if it doesn't exist
        IF NOT has_doctor_id THEN
            ALTER TABLE telemedicine_sessions 
            ADD COLUMN doctor_id INTEGER REFERENCES users(id);
            
            -- Update existing records to set doctor_id from appointments
            UPDATE telemedicine_sessions ts
            SET doctor_id = a.doctor_id
            FROM appointments a
            WHERE ts.appointment_id = a.id;
            
            RAISE NOTICE 'Added doctor_id column to telemedicine_sessions';
        END IF;

    ELSE
        -- Create the table with all necessary columns
        CREATE TABLE telemedicine_sessions (
            id SERIAL PRIMARY KEY,
            appointment_id INTEGER NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
            patient_id INTEGER REFERENCES users(id),
            doctor_id INTEGER REFERENCES users(id),
            status VARCHAR(50) DEFAULT 'scheduled',
            scheduled_time TIMESTAMP,
            started_at TIMESTAMP,
            ended_at TIMESTAMP,
            notes TEXT,
            session_summary TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        -- Create indexes for better performance
        CREATE INDEX idx_telemedicine_sessions_appointment_id ON telemedicine_sessions(appointment_id);
        CREATE INDEX idx_telemedicine_sessions_patient_id ON telemedicine_sessions(patient_id);
        CREATE INDEX idx_telemedicine_sessions_doctor_id ON telemedicine_sessions(doctor_id);
        CREATE INDEX idx_telemedicine_sessions_status ON telemedicine_sessions(status);

        RAISE NOTICE 'Created telemedicine_sessions table with all columns';
    END IF;
END $$;
