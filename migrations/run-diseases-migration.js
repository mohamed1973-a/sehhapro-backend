const fs = require("fs")
const path = require("path")
const { pool } = require("../config/database")

async function runMigration() {
  const client = await pool.connect()

  try {
    console.log("Starting diseases migration...")

    // Begin transaction
    await client.query("BEGIN")

    // Read and execute the SQL file
    const sqlPath = path.join(__dirname, "create_diseases_table.sql")
    const sql = fs.readFileSync(sqlPath, "utf8")

    await client.query(sql)

    // Commit transaction
    await client.query("COMMIT")

    console.log("Diseases migration completed successfully")
  } catch (error) {
    // Rollback transaction on error
    await client.query("ROLLBACK")
    console.error("Error running diseases migration:", error)
    throw error
  } finally {
    // Release client
    client.release()
  }
}

// Run the migration
runMigration()
  .then(() => {
    console.log("Migration script completed")
    process.exit(0)
  })
  .catch((err) => {
    console.error("Migration script failed:", err)
    process.exit(1)
  })
