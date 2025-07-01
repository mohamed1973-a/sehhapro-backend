const { pool } = require('./config/database');
const logger = require('./middleware/logger');

async function testPaymentSystem() {
  try {
    console.log('=== PAYMENT SYSTEM TEST ===');
    
    // 1. Check the schema of patient_transactions table
    console.log('Checking patient_transactions table schema...');
    const schemaQuery = await pool.query(`
      SELECT column_name, data_type, character_maximum_length, 
             is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'patient_transactions'
      ORDER BY ordinal_position
    `);
    
    console.log('Table schema:');
    schemaQuery.rows.forEach(col => {
      console.log(`  ${col.column_name}: ${col.data_type}${col.character_maximum_length ? `(${col.character_maximum_length})` : ''} ${col.is_nullable === 'NO' ? 'NOT NULL' : ''} ${col.column_default ? `DEFAULT ${col.column_default}` : ''}`);
    });
    
    // 2. Check constraints on the status column
    console.log('\nChecking constraints on status column...');
    const constraintQuery = await pool.query(`
      SELECT pg_get_constraintdef(c.oid) as constraint_def
      FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      JOIN pg_class t ON t.oid = c.conrelid
      WHERE t.relname = 'patient_transactions'
      AND c.contype = 'c'
    `);
    
    console.log('Constraints:');
    constraintQuery.rows.forEach(con => {
      console.log(`  ${con.constraint_def}`);
    });
    
    // 3. Check existing transactions
    console.log('\nChecking existing transactions...');
    const existingQuery = await pool.query(`
      SELECT id, patient_id, type, amount, status, payment_method, related_appointment_id, created_at
      FROM patient_transactions
      ORDER BY created_at DESC
      LIMIT 10
    `);
    
    console.log(`Found ${existingQuery.rows.length} transactions:`);
    existingQuery.rows.forEach(tx => {
      console.log(`  ID: ${tx.id}, Patient: ${tx.patient_id}, Type: ${tx.type}, Amount: ${tx.amount}, Status: ${tx.status}, Method: ${tx.payment_method}, Appointment: ${tx.related_appointment_id}, Created: ${tx.created_at}`);
    });
    
    // 4. Test inserting a transaction directly
    console.log('\nTesting direct transaction insertion...');
    const patientId = existingQuery.rows.length > 0 ? existingQuery.rows[0].patient_id : 1;
    
    const insertResult = await pool.query(
      `INSERT INTO patient_transactions 
       (patient_id, type, amount, description, payment_method, status, related_appointment_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        patientId,
        'payment',
        100.00,
        'Test payment transaction',
        'balance',
        'pending',
        null
      ]
    );
    
    if (insertResult.rows.length > 0) {
      console.log('Successfully inserted test transaction:');
      console.log(`  ID: ${insertResult.rows[0].id}, Status: ${insertResult.rows[0].status}`);
      
      // Clean up the test transaction
      await pool.query('DELETE FROM patient_transactions WHERE id = $1', [insertResult.rows[0].id]);
      console.log('Test transaction cleaned up');
    } else {
      console.log('Failed to insert test transaction');
    }
    
  } catch (error) {
    console.error('Error during payment system test:', error.message);
    console.error(error.stack);
  } finally {
    await pool.end();
    console.log('=== TEST COMPLETE ===');
  }
}

testPaymentSystem();
