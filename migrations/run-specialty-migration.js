const { pool } = require("../config/database")
const fs = require("fs")
const path = require("path")

async function runSpecialtyMigration() {
  const client = await pool.connect()

  try {
    console.log("Starting specialty column migration...")

    // Read the SQL migration file
    const migrationPath = path.join(__dirname, "add_specialty_to_appointments.sql")
    const migrationSQL = fs.readFileSync(migrationPath, "utf8")

    // Execute the migration
    await client.query(migrationSQL)

    console.log("✅ Specialty column migration completed successfully!")
  } catch (error) {
    console.error("❌ Error running specialty migration:", error.message)
    throw error
  } finally {
    client.release()
  }
}

// Run the migration if this file is executed directly
if (require.main === module) {
  runSpecialtyMigration()
    .then(() => {
      console.log("Migration completed successfully!")
      process.exit(0)
    })
    .catch((error) => {
      console.error("Migration failed:", error)
      process.exit(1)
    })
}

module.exports = { runSpecialtyMigration }
