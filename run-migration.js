const fs = require('fs');
const path = require('path');
const { pool } = require('./config/database');

async function runMigration() {
  try {
    console.log('🚀 Starting patient balance system migration...');
    
    // Read the migration file
    const migrationPath = path.join(__dirname, 'migrations', 'add_patient_balance_system.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    console.log('📄 Migration file loaded successfully');
    
    // Execute the migration
    await pool.query(migrationSQL);
    
    console.log('✅ Migration completed successfully!');
    console.log('🎉 Patient balance system is now ready');
    
    // Test the connection
    const result = await pool.query('SELECT COUNT(*) as count FROM patient_transactions');
    console.log(`📊 Found ${result.rows[0].count} transactions in the system`);
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error('Full error:', error);
  } finally {
    await pool.end();
  }
}

runMigration();
