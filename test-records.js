const { pool } = require('./config/database');

async function testRecords() {
  try {
    console.log('Testing medical records...');
    
    // Check total count
    const countResult = await pool.query('SELECT COUNT(*) as count FROM medical_records');
    console.log('Total medical records:', countResult.rows[0].count);
    
    // Check records for patient 7 (from the logs)
    const patientRecords = await pool.query(`
      SELECT mr.*, u.full_name as doctor_name, c.name as clinic_name
      FROM medical_records mr 
      JOIN users u ON mr.doctor_id = u.id
      LEFT JOIN clinics c ON mr.clinic_id = c.id
      WHERE mr.patient_id = 7
      ORDER BY mr.created_at DESC
    `);
    
    console.log('Records for patient 7:', patientRecords.rows.length);
    console.log('Sample records:', JSON.stringify(patientRecords.rows, null, 2));
    
    // Check if there are any records at all
    const allRecords = await pool.query(`
      SELECT mr.*, u1.full_name as patient_name, u2.full_name as doctor_name, c.name as clinic_name
      FROM medical_records mr 
      JOIN users u1 ON mr.patient_id = u1.id
      JOIN users u2 ON mr.doctor_id = u2.id
      LEFT JOIN clinics c ON mr.clinic_id = c.id
      LIMIT 5
    `);
    
    console.log('All records sample:', allRecords.rows.length);
    console.log('Sample all records:', JSON.stringify(allRecords.rows, null, 2));
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

testRecords();
