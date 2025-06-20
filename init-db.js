/**
 * Database initialization script
 * Creates schema and initial data for PostgreSQL
 */
const { pool } = require("./config/database")
const logger = require("./middleware/logger")
const fs = require("fs")
const path = require("path")
const bcrypt = require("bcrypt")

async function initializeDatabase() {
  let client = null

  try {
    logger.info("Starting database initialization...")
    client = await pool.connect()

    // Read the unified schema file
    const schemaPath = path.join(__dirname, "schema-unified.sql")

    // Check if schema file exists
    if (!fs.existsSync(schemaPath)) {
      logger.error("Schema file not found. Please ensure schema-unified.sql exists in the root directory.")
      console.error("Schema file not found. Please ensure schema-unified.sql exists in the root directory.")
      return
    }

    const schema = fs.readFileSync(schemaPath, "utf8")

    // Execute the schema in a transaction
    await client.query("BEGIN")

    // Split the schema into individual statements and execute them
    const statements = schema
      .replace(/\/\*[\s\S]*?\*\//g, "") // Remove multi-line comments
      .replace(/--.*$/gm, "") // Remove single-line comments
      .split(";")
      .filter((stmt) => stmt.trim())

    for (const statement of statements) {
      try {
        await client.query(statement)
      } catch (err) {
        // Log the error but continue with other statements
        logger.warn(`Error executing statement: ${err.message}`)
        logger.warn(`Statement: ${statement.trim().substring(0, 100)}...`)
      }
    }

    logger.info("Database schema initialized successfully")

    // Check if critical tables exist
    const criticalTables = [
      "users",
      "roles",
      "clinics",
      "appointments",
      "availability_slots",
      "lab_requests",
      "telemedicine_sessions",
      "doctor_clinics",
      "lab_clinics",
      "patient_clinics",
    ]

    for (const table of criticalTables) {
      const tableCheck = await client.query(
        "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)",
        [table],
      )

      if (!tableCheck.rows[0].exists) {
        logger.warn(`Critical table missing: ${table}`)
      }
    }

    // Check if we need to create a default platform admin
    const adminCheck = await client.query(
      "SELECT COUNT(*) FROM users u JOIN roles r ON u.role_id = r.id WHERE r.name = 'platform_admin'",
    )

    if (adminCheck.rows[0].count === "0") {
      logger.info("Creating default platform admin user...")

      // Get the role_id for platform_admin
      const roleResult = await client.query("SELECT id FROM roles WHERE name = 'platform_admin'")

      if (roleResult.rows.length === 0) {
        logger.error("Role 'platform_admin' not found in the database")
        await client.query("ROLLBACK")
        return
      }

      const roleId = roleResult.rows[0].id

      // Hash the password
      const salt = await bcrypt.genSalt(10)
      const hashedPassword = await bcrypt.hash("password123", salt)

      // Create a default platform admin user
      await client.query("INSERT INTO users (email, password_hash, full_name, role_id) VALUES ($1, $2, $3, $4)", [
        "admin@example.com",
        hashedPassword,
        "Platform Admin",
        roleId,
      ])

      logger.info("Default platform admin user created (email: admin@example.com, password: password123)")
    }

    // Create a default clinic if none exists
    const clinicCheck = await client.query("SELECT COUNT(*) FROM clinics")

    if (clinicCheck.rows[0].count === "0") {
      logger.info("Creating default clinic...")

      await client.query("INSERT INTO clinics (name, address, phone, email, type) VALUES ($1, $2, $3, $4, $5)", [
        "Main Hospital",
        "123 Main Street",
        "555-1234",
        "info@mainhospital.com",
        "main",
      ])

      logger.info("Default clinic created")
    }

    await client.query("COMMIT")
    logger.info("Database initialization completed successfully")
  } catch (error) {
    if (client) await client.query("ROLLBACK")
    logger.error(`Database initialization error: ${error.message}`)
    console.error("Database initialization failed:", error)
  } finally {
    if (client) client.release()
    await pool.end()
  }
}

// Run the initialization if this file is executed directly
if (require.main === module) {
  initializeDatabase()
}

module.exports = { initializeDatabase }
