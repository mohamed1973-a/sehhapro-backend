-- Add specialty column to appointments table if it doesn't exist

DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'appointments' AND column_name = 'specialty') THEN
        ALTER TABLE appointments ADD COLUMN specialty VARCHAR(100);
        
        -- Update existing appointments with default specialty
        UPDATE appointments 
        SET specialty = COALESCE(
            (SELECT dp.specialty 
             FROM doctor_portfolios dp 
             WHERE dp.doctor_id = appointments.doctor_id 
             LIMIT 1), 
            'General Medicine'
        )
        WHERE specialty IS NULL;
        
        RAISE NOTICE 'Added specialty column to appointments table';
    ELSE
        RAISE NOTICE 'Specialty column already exists in appointments table';
    END IF;
END $$;
