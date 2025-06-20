const { pool } = require("../config/database")
const fs = require("fs")
const path = require("path")

async function runTelemedicineFix() {
  const client = await pool.connect()

  try {
    console.log("Starting telemedicine sessions table fix...")

    // Read the SQL migration file
    const migrationPath = path.join(__dirname, "fix_telemedicine_sessions.sql")
    const migrationSQL = fs.readFileSync(migrationPath, "utf8")

    // Execute the migration
    await client.query(migrationSQL)

    console.log("✅ Telemedicine sessions table fix completed successfully!")
    console.log("Added columns: session_url, meeting_id, session_summary, started_at, ended_at")
  } catch (error) {
    console.error("❌ Error running telemedicine fix:", error.message)
    throw error
  } finally {
    client.release()
  }
}

// Run the migration if this file is executed directly
if (require.main === module) {
  runTelemedicineFix()
    .then(() => {
      console.log("Migration completed successfully!")
      process.exit(0)
    })
    .catch((error) => {
      console.error("Migration failed:", error)
      process.exit(1)
    })
}

module.exports = { runTelemedicineFix }
