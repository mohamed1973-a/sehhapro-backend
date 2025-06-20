/**
 * Migration runner to allow NULL clinic_id for telemedicine appointments
 * Run this script to update the database schema
 */

const { pool } = require("../config/database")
const fs = require("fs")
const path = require("path")

async function runMigration() {
  try {
    console.log("🔄 Starting migration to allow NULL clinic_id for telemedicine...")

    // Read the migration SQL file
    const migrationPath = path.join(__dirname, "allow_null_clinic_id_for_telemedicine.sql")
    const migrationSQL = fs.readFileSync(migrationPath, "utf8")

    // Split the SQL into individual statements (simple split by semicolon)
    const statements = migrationSQL
      .split(";")
      .map((stmt) => stmt.trim())
      .filter((stmt) => stmt.length > 0 && !stmt.startsWith("--"))

    await pool.query("BEGIN")

    for (const statement of statements) {
      if (statement.trim()) {
        console.log(`Executing: ${statement.substring(0, 100)}...`)
        await pool.query(statement)
      }
    }

    await pool.query("COMMIT")
    console.log("✅ Migration completed successfully!")
    console.log("📋 Summary of changes:")
    console.log("   - clinic_id column now allows NULL values")
    console.log("   - Updated indexes for better performance")
    console.log("   - Telemedicine appointments can now be created without clinic_id")

    // Verify the change
    const result = await pool.query(`
      SELECT column_name, is_nullable, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'availability_slots' AND column_name = 'clinic_id'
    `)

    console.log("🔍 Verification:")
    console.log("   clinic_id column is_nullable:", result.rows[0]?.is_nullable)

    process.exit(0)
  } catch (error) {
    await pool.query("ROLLBACK")
    console.error("❌ Migration failed:", error.message)
    console.error("Full error:", error)
    process.exit(1)
  }
}

// Run the migration if this file is executed directly
if (require.main === module) {
  runMigration()
}

module.exports = { runMigration }
