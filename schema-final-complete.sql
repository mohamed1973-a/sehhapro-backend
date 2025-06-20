-- =====================================================
-- MEDICATIONS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS medications (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  generic_name VARCHAR(255),
  brand_names JSONB, -- Array of brand names: ["Tylenol", "Panadol"]
  drug_class VARCHAR(100), -- e.g., "Analgesic", "Antibiotic"
  category VARCHAR(100), -- e.g., "Pain Relief", "Infection"
  active_ingredient VARCHAR(255),
  strength_options JSONB, -- Array of available strengths: ["250mg", "500mg", "1000mg"]
  form_types JSONB, -- Array of forms: ["tablet", "capsule", "liquid", "injection"]
  route_of_administration JSONB, -- ["oral", "topical", "intravenous"]

  -- Dosage information
  standard_dosage JSONB, -- {"adult": "500mg every 6 hours", "child": "250mg every 8 hours"}
  max_daily_dose VARCHAR(100), -- "4000mg"
  duration_guidelines VARCHAR(255), -- "7-10 days for infection"

  -- Safety information
  contraindications TEXT, -- Conditions where this drug should not be used
  side_effects JSONB, -- ["nausea", "dizziness", "headache"]
  drug_interactions JSONB, -- Array of drug IDs or names that interact
  pregnancy_category VARCHAR(10), -- A, B, C, D, X
  controlled_substance_schedule VARCHAR(10), -- I, II, III, IV, V (for controlled substances)

  -- Regulatory and identification
  ndc_number VARCHAR(50), -- National Drug Code
  rxcui VARCHAR(50), -- RxNorm Concept Unique Identifier
  fda_approved BOOLEAN DEFAULT TRUE,
  prescription_required BOOLEAN DEFAULT TRUE,

  -- Platform management
  status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'discontinued')),
  added_by_admin_id INT REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT, -- Admin notes about the medication

  -- Pricing (optional)
  average_cost DECIMAL(10,2), -- Average cost per unit
  insurance_tier VARCHAR(20), -- "tier1", "tier2", "tier3", "specialty"

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_medications_name ON medications(name);
CREATE INDEX IF NOT EXISTS idx_medications_generic_name ON medications(generic_name);
CREATE INDEX IF NOT EXISTS idx_medications_drug_class ON medications(drug_class);
CREATE INDEX IF NOT EXISTS idx_medications_category ON medications(category);
CREATE INDEX IF NOT EXISTS idx_medications_status ON medications(status);
CREATE INDEX IF NOT EXISTS idx_medications_prescription_required ON medications(prescription_required);

-- Add GIN indexes for JSONB fields for better search performance
CREATE INDEX IF NOT EXISTS idx_medications_brand_names_gin ON medications USING GIN (brand_names);
CREATE INDEX IF NOT EXISTS idx_medications_strength_options_gin ON medications USING GIN (strength_options);
CREATE INDEX IF NOT EXISTS idx_medications_side_effects_gin ON medications USING GIN (side_effects);

-- Add trigger for automatic timestamp updates
CREATE TRIGGER update_medications_modtime
  BEFORE UPDATE ON medications
  FOR EACH ROW EXECUTE FUNCTION update_modified_column();

-- Insert real medication data
INSERT INTO medications (
  name, generic_name, brand_names, drug_class, category, active_ingredient,
  strength_options, form_types, route_of_administration, standard_dosage,
  max_daily_dose, duration_guidelines, contraindications, side_effects,
  pregnancy_category, prescription_required, fda_approved, added_by_admin_id
) VALUES
-- Pain Relief
(
  'Acetaminophen', 'Acetaminophen', '["Tylenol", "Panadol"]', 'Analgesic', 'Pain Relief',
  'Acetaminophen', '["325mg", "500mg", "650mg"]', '["tablet", "capsule", "liquid"]',
  '["oral"]', '{"adult": "500-1000mg every 4-6 hours", "child": "10-15mg/kg every 4-6 hours"}',
  '4000mg', 'As needed, maximum 10 days', 'Severe liver disease', '["liver damage with overdose"]',
  'B', FALSE, TRUE, 1
),
(
  'Ibuprofen', 'Ibuprofen', '["Advil", "Motrin", "Nurofen"]', 'NSAID', 'Pain Relief',
  'Ibuprofen', '["200mg", "400mg", "600mg", "800mg"]', '["tablet", "capsule", "liquid"]',
  '["oral"]', '{"adult": "400mg every 6-8 hours", "child": "10mg/kg every 6-8 hours"}',
  '2400mg', 'As needed, maximum 10 days', 'Active peptic ulcer, severe heart failure', '["stomach upset", "nausea", "dizziness"]',
  'C', FALSE, TRUE, 1
),

-- Antibiotics
(
  'Amoxicillin', 'Amoxicillin', '["Amoxil", "Trimox"]', 'Penicillin', 'Antibiotic',
  'Amoxicillin trihydrate', '["250mg", "500mg", "875mg"]', '["capsule", "tablet", "suspension"]',
  '["oral"]', '{"adult": "500mg every 8 hours", "child": "25-45mg/kg/day divided"}',
  '3000mg', '7-10 days', 'Penicillin allergy', '["diarrhea", "nausea", "rash"]',
  'B', TRUE, TRUE, 1
),
(
  'Azithromycin', 'Azithromycin', '["Zithromax", "Z-Pak"]', 'Macrolide', 'Antibiotic',
  'Azithromycin', '["250mg", "500mg"]', '["tablet", "suspension"]',
  '["oral"]', '{"adult": "500mg day 1, then 250mg daily", "child": "10mg/kg day 1, then 5mg/kg daily"}',
  '500mg', '5 days', 'Macrolide allergy', '["nausea", "diarrhea", "abdominal pain"]',
  'B', TRUE, TRUE, 1
),

-- Cardiovascular
(
  'Lisinopril', 'Lisinopril', '["Prinivil", "Zestril"]', 'ACE Inhibitor', 'Cardiovascular',
  'Lisinopril', '["2.5mg", "5mg", "10mg", "20mg", "40mg"]', '["tablet"]',
  '["oral"]', '{"adult": "10mg once daily"}',
  '40mg', 'Long-term therapy', 'Pregnancy, angioedema history', '["dry cough", "hyperkalemia", "hypotension"]',
  'D', TRUE, TRUE, 1
),
(
  'Metoprolol', 'Metoprolol', '["Lopressor", "Toprol-XL"]', 'Beta Blocker', 'Cardiovascular',
  'Metoprolol', '["25mg", "50mg", "100mg", "200mg"]', '["tablet", "extended-release"]',
  '["oral"]', '{"adult": "50mg twice daily"}',
  '400mg', 'Long-term therapy', 'Severe bradycardia, heart block', '["fatigue", "dizziness", "depression"]',
  'C', TRUE, TRUE, 1
),

-- Diabetes
(
  'Metformin', 'Metformin', '["Glucophage", "Fortamet"]', 'Biguanide', 'Diabetes',
  'Metformin hydrochloride', '["500mg", "850mg", "1000mg"]', '["tablet", "extended-release"]',
  '["oral"]', '{"adult": "500mg twice daily with meals"}',
  '2550mg', 'Long-term therapy', 'Kidney disease, metabolic acidosis', '["nausea", "diarrhea", "metallic taste"]',
  'B', TRUE, TRUE, 1
),

-- Mental Health
(
  'Sertraline', 'Sertraline', '["Zoloft"]', 'SSRI', 'Mental Health',
  'Sertraline hydrochloride', '["25mg", "50mg", "100mg"]', '["tablet", "oral solution"]',
  '["oral"]', '{"adult": "50mg once daily"}',
  '200mg', 'Long-term therapy', 'MAOI use within 14 days', '["nausea", "insomnia", "sexual dysfunction"]',
  'C', TRUE, TRUE, 1
),

-- Respiratory
(
  'Albuterol', 'Albuterol', '["ProAir", "Ventolin", "Proventil"]', 'Beta2 Agonist', 'Respiratory',
  'Albuterol sulfate', '["90mcg/puff", "2.5mg/3ml"]', '["inhaler", "nebulizer solution"]',
  '["inhalation"]', '{"adult": "2 puffs every 4-6 hours as needed"}',
  '8 puffs per day', 'As needed', 'Hypersensitivity to albuterol', '["tremor", "nervousness", "headache"]',
  'C', TRUE, TRUE, 1
),

-- Gastrointestinal
(
  'Omeprazole', 'Omeprazole', '["Prilosec"]', 'Proton Pump Inhibitor', 'Gastrointestinal',
  'Omeprazole', '["10mg", "20mg", "40mg"]', '["capsule", "tablet"]',
  '["oral"]', '{"adult": "20mg once daily before breakfast"}',
  '40mg', '4-8 weeks for ulcers', 'Hypersensitivity to omeprazole', '["headache", "nausea", "diarrhea"]',
  'C', FALSE, TRUE, 1
);
