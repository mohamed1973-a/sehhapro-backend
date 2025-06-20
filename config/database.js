/**
 * Database configuration for PostgreSQL
 * Optimized for pgAdmin compatibility and connection pooling
 */
const { Pool } = require("pg")
require("dotenv").config()

// Create connection pool with optimized settings
const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT || 5432,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
  // Connection pool settings optimized for production
  max: 20, // Maximum number of clients in the pool
  idleTimeoutMillis: 30000, // How long a client is allowed to remain idle before being closed
  connectionTimeoutMillis: 5000, // Increased timeout for initial connection
})

// Improved error handling for connection issues
pool.on("error", (err) => {
  console.error("Unexpected database pool error:", err)
  // Don't crash the server on connection errors
})

// Enhanced connection testing with detailed diagnostics
async function testConnection() {
  try {
    const client = await pool.connect()
    try {
      // Test basic query
      await client.query("SELECT NOW()")
      console.log("✅ Database connection successful")

      // Check for essential tables
      const tablesResult = await client.query(`
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name IN ('users', 'roles', 'clinics', 'appointments')
      `)

      const foundTables = tablesResult.rows.map((row) => row.table_name)
      const requiredTables = ["users", "roles", "clinics", "appointments"]
      const missingTables = requiredTables.filter((table) => !foundTables.includes(table))

      if (missingTables.length > 0) {
        console.warn(`⚠️ Missing essential tables: ${missingTables.join(", ")}`)
        console.warn("Run 'node init-db.js' to initialize the database schema")
        return false
      }

      console.log("✅ All essential database tables verified")
      return true
    } finally {
      client.release()
    }
  } catch (err) {
    console.error("❌ Database connection failed:", err.message)
    if (err.code === "ECONNREFUSED") {
      console.error("Make sure PostgreSQL is running and check your connection settings in .env")
    } else if (err.code === "28P01") {
      console.error("Authentication failed. Check your database username and password")
    } else if (err.code === "3D000") {
      console.error(`Database "${process.env.DB_NAME}" does not exist. Create it in pgAdmin first`)
    }
    return false
  }
}

module.exports = { pool, testConnection }
