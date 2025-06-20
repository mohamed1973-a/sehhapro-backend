const { Pool } = require("pg")
const fs = require("fs")
const path = require("path")

// Database configuration
const pool = new Pool({
  user: process.env.DB_USER || "postgres",
  host: process.env.DB_HOST || "localhost",
  database: process.env.DB_NAME || "healthcare_platform",
  password: process.env.DB_PASSWORD || "password",
  port: process.env.DB_PORT || 5432,
})

async function runPrescriptionMigration() {
  const client = await pool.connect()

  try {
    console.log("Starting prescription table migration...")

    // Read the migration file
    const migrationPath = path.join(__dirname, "create_prescriptions_table.sql")
    const migrationSQL = fs.readFileSync(migrationPath, "utf8")

    // Execute the migration
    await client.query(migrationSQL)

    console.log("✅ Prescription table migration completed successfully!")

    // Verify the table was created
    const tableCheck = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns 
      WHERE table_name = 'prescriptions'
      ORDER BY ordinal_position
    `)

    console.log("\n📋 Prescription table structure:")
    console.table(tableCheck.rows)

    // Check if there are any existing prescriptions
    const countResult = await client.query("SELECT COUNT(*) FROM prescriptions")
    console.log(`\n📊 Current prescriptions count: ${countResult.rows[0].count}`)
  } catch (error) {
    console.error("❌ Error running prescription migration:", error.message)
    throw error
  } finally {
    client.release()
    await pool.end()
  }
}

// Run the migration
if (require.main === module) {
  runPrescriptionMigration()
    .then(() => {
      console.log("Migration completed successfully!")
      process.exit(0)
    })
    .catch((error) => {
      console.error("Migration failed:", error)
      process.exit(1)
    })
}

module.exports = runPrescriptionMigration
