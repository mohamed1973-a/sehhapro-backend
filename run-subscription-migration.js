const fs = require('fs');
const path = require('path');
const { pool } = require('./config/database');

async function runSubscriptionMigration() {
  try {
    console.log('🔄 Starting subscription system migration...');
    
    // Read the SQL migration file
    const migrationPath = path.join(__dirname, 'migrations', 'create_subscription_tables.sql');
    const sqlContent = fs.readFileSync(migrationPath, 'utf8');
    
    // Split the SQL into individual statements
    const statements = sqlContent
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
    
    console.log(`📝 Found ${statements.length} SQL statements to execute`);
    
    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (statement.trim()) {
        try {
          console.log(`⏳ Executing statement ${i + 1}/${statements.length}...`);
          await pool.query(statement);
          console.log(`✅ Statement ${i + 1} executed successfully`);
        } catch (error) {
          // Skip if table already exists or trigger already exists
          if (error.message.includes('already exists') || error.message.includes('duplicate key')) {
            console.log(`⚠️ Statement ${i + 1} skipped (already exists): ${error.message}`);
          } else {
            console.error(`❌ Error executing statement ${i + 1}:`, error.message);
            throw error;
          }
        }
      }
    }
    
    console.log('🎉 Subscription system migration completed successfully!');
    console.log('📊 Default subscription plans have been created:');
    console.log('   - Basic ($99/month)');
    console.log('   - Professional ($199/month)');
    console.log('   - Enterprise ($399/month)');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run the migration
runSubscriptionMigration();
