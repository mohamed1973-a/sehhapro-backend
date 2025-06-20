-- Create diseases table if it doesn't exist
CREATE TABLE IF NOT EXISTS diseases (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  icd_code VARCHAR(20),
  description TEXT,
  category VARCHAR(100),
  severity VARCHAR(20) CHECK (severity IN ('mild', 'moderate', 'severe', 'critical')),
  symptoms JSONB,
  common_treatments JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create disease_medications table for linking diseases to medications
CREATE TABLE IF NOT EXISTS disease_medications (
  id SERIAL PRIMARY KEY,
  disease_id INTEGER REFERENCES diseases(id) ON DELETE CASCADE,
  medication_id INTEGER REFERENCES medications(id) ON DELETE CASCADE,
  default_dose VARCHAR(100),
  default_frequency VARCHAR(100),
  default_duration VARCHAR(100),
  notes_for_disease TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(disease_id, medication_id)
);

-- Insert some common diseases if table is empty
INSERT INTO diseases (name, icd_code, description, category, severity)
SELECT * FROM (
  VALUES 
    ('Hypertension', 'I10', 'High blood pressure', 'Cardiovascular', 'moderate'),
    ('Type 2 Diabetes Mellitus', 'E11', 'Non-insulin-dependent diabetes mellitus', 'Endocrine', 'moderate'),
    ('Acute Upper Respiratory Infection', 'J06.9', 'Common cold or flu-like symptoms', 'Respiratory', 'mild'),
    ('Gastroesophageal Reflux Disease', 'K21.9', 'GERD - acid reflux condition', 'Digestive', 'mild'),
    ('Migraine', 'G43.9', 'Recurrent headache disorder', 'Neurological', 'moderate'),
    ('Asthma', 'J45.9', 'Chronic respiratory condition', 'Respiratory', 'moderate'),
    ('Depression', 'F32.9', 'Major depressive disorder', 'Mental Health', 'moderate'),
    ('Osteoarthritis', 'M19.9', 'Degenerative joint disease', 'Musculoskeletal', 'moderate'),
    ('Coronary Artery Disease', 'I25.1', 'Atherosclerotic heart disease', 'Cardiovascular', 'severe'),
    ('Chronic Obstructive Pulmonary Disease', 'J44.9', 'COPD - progressive lung disease', 'Respiratory', 'severe')
) AS new_values
WHERE NOT EXISTS (SELECT 1 FROM diseases LIMIT 1);
