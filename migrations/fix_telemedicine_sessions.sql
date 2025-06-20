-- Add missing columns to telemedicine_sessions table if they don't exist

-- Add session_url column
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'telemedicine_sessions' AND column_name = 'session_url') THEN
        ALTER TABLE telemedicine_sessions ADD COLUMN session_url VARCHAR(500);
    END IF;
END $$;

-- Add meeting_id column
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'telemedicine_sessions' AND column_name = 'meeting_id') THEN
        ALTER TABLE telemedicine_sessions ADD COLUMN meeting_id VARCHAR(255);
    END IF;
END $$;

-- Add session_summary column
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'telemedicine_sessions' AND column_name = 'session_summary') THEN
        ALTER TABLE telemedicine_sessions ADD COLUMN session_summary TEXT;
    END IF;
END $$;

-- Add started_at column
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'telemedicine_sessions' AND column_name = 'started_at') THEN
        ALTER TABLE telemedicine_sessions ADD COLUMN started_at TIMESTAMP;
    END IF;
END $$;

-- Add ended_at column
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns 
                   WHERE table_name = 'telemedicine_sessions' AND column_name = 'ended_at') THEN
        ALTER TABLE telemedicine_sessions ADD COLUMN ended_at TIMESTAMP;
    END IF;
END $$;

-- Update existing records with default values
UPDATE telemedicine_sessions 
SET session_url = COALESCE(session_url, ''),
    meeting_id = COALESCE(meeting_id, ''),
    session_summary = COALESCE(session_summary, ''),
    started_at = COALESCE(started_at, created_at),
    ended_at = COALESCE(ended_at, updated_at)
WHERE session_url IS NULL OR meeting_id IS NULL OR session_summary IS NULL 
   OR started_at IS NULL OR ended_at IS NULL;
