const { pool } = require("../config/database")
const fs = require("fs")
const path = require("path")

async function runTelemedicineSchemaFix() {
  const client = await pool.connect()

  try {
    console.log("Starting telemedicine_sessions schema fix...")

    // Read the migration SQL file
    const migrationPath = path.join(__dirname, "fix_telemedicine_sessions_schema.sql")
    const migrationSQL = fs.readFileSync(migrationPath, "utf8")

    // Execute the migration
    await client.query("BEGIN")
    await client.query(migrationSQL)
    await client.query("COMMIT")

    console.log("✅ Telemedicine sessions schema fix completed successfully!")

    // Verify the table structure
    const columnsResult = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_name = 'telemedicine_sessions'
      ORDER BY ordinal_position
    `)

    console.log("\n📋 Current telemedicine_sessions table structure:")
    columnsResult.rows.forEach((row) => {
      console.log(`  - ${row.column_name}: ${row.data_type} (${row.is_nullable === "YES" ? "nullable" : "not null"})`)
    })
  } catch (error) {
    await client.query("ROLLBACK")
    console.error("❌ Migration failed:", error.message)
    throw error
  } finally {
    client.release()
  }
}

// Run the migration if this file is executed directly
if (require.main === module) {
  runTelemedicineSchemaFix()
    .then(() => {
      console.log("\n🎉 Migration completed!")
      process.exit(0)
    })
    .catch((error) => {
      console.error("\n💥 Migration failed:", error)
      process.exit(1)
    })
}

module.exports = runTelemedicineSchemaFix
