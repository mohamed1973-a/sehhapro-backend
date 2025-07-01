const { pool } = require('./config/database');

async function createTestRecords() {
  try {
    console.log('Creating test medical records...');
    
    // Get patient and doctor IDs
    const patientResult = await pool.query("SELECT id FROM users WHERE role_id = (SELECT id FROM roles WHERE name = 'patient') LIMIT 1");
    const doctorResult = await pool.query("SELECT id FROM users WHERE role_id = (SELECT id FROM roles WHERE name = 'doctor') LIMIT 1");
    const clinicResult = await pool.query("SELECT id FROM clinics LIMIT 1");
    
    if (patientResult.rows.length === 0 || doctorResult.rows.length === 0) {
      console.log('No patient or doctor found. Creating users first...');
      return;
    }
    
    const patientId = patientResult.rows[0].id;
    const doctorId = doctorResult.rows[0].id;
    const clinicId = clinicResult.rows.length > 0 ? clinicResult.rows[0].id : null;
    
    console.log(`Using patient ID: ${patientId}, doctor ID: ${doctorId}, clinic ID: ${clinicId}`);
    
    // Create test medical records
    const testRecords = [
      {
        patient_id: patientId,
        doctor_id: doctorId,
        clinic_id: clinicId,
        entry_type: 'consultation',
        title: 'Annual Health Checkup',
        diagnosis: 'Healthy individual with no significant health issues',
        treatment: 'Continue healthy lifestyle, annual checkup recommended',
        notes: 'Patient reports feeling well. Blood pressure normal, weight stable. No new symptoms reported.',
        follow_up_required: true,
        follow_up_date: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year from now
        priority: 'normal',
        is_confidential: false
      },
      {
        patient_id: patientId,
        doctor_id: doctorId,
        clinic_id: clinicId,
        entry_type: 'diagnosis',
        title: 'Upper Respiratory Infection',
        diagnosis: 'Acute upper respiratory infection',
        treatment: 'Rest, fluids, over-the-counter pain relievers as needed',
        notes: 'Patient presented with sore throat, mild fever, and nasal congestion. Symptoms started 2 days ago.',
        follow_up_required: false,
        priority: 'normal',
        is_confidential: false
      },
      {
        patient_id: patientId,
        doctor_id: doctorId,
        clinic_id: clinicId,
        entry_type: 'treatment',
        title: 'Blood Pressure Management',
        diagnosis: 'Pre-hypertension',
        treatment: 'Lifestyle modifications: reduce salt intake, increase physical activity, stress management',
        notes: 'Blood pressure readings consistently in pre-hypertensive range. No medication needed at this time.',
        follow_up_required: true,
        follow_up_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 1 month from now
        priority: 'normal',
        is_confidential: false
      },
      {
        patient_id: patientId,
        doctor_id: doctorId,
        clinic_id: clinicId,
        entry_type: 'consultation',
        title: 'Follow-up Visit',
        diagnosis: 'Stable condition',
        treatment: 'Continue current treatment plan',
        notes: 'Patient doing well. All symptoms resolved. Continue with current medications and lifestyle recommendations.',
        follow_up_required: true,
        follow_up_date: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 3 months from now
        priority: 'normal',
        is_confidential: false
      }
    ];
    
    for (const record of testRecords) {
      const result = await pool.query(`
        INSERT INTO medical_records 
        (patient_id, doctor_id, clinic_id, entry_type, title, diagnosis, treatment, notes, follow_up_required, follow_up_date, priority, is_confidential, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
        RETURNING id
      `, [
        record.patient_id,
        record.doctor_id,
        record.clinic_id,
        record.entry_type,
        record.title,
        record.diagnosis,
        record.treatment,
        record.notes,
        record.follow_up_required,
        record.follow_up_date,
        record.priority,
        record.is_confidential
      ]);
      
      console.log(`Created medical record with ID: ${result.rows[0].id}`);
    }
    
    console.log('Test medical records created successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Error creating test records:', error);
    process.exit(1);
  }
}

createTestRecords();
