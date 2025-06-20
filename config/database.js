/**
 * Database configuration for PostgreSQL
 * Optimized for Neon Database and connection pooling
 */
const { Pool } = require("pg")
require("dotenv").config()

// Parse Neon database URL if provided, otherwise use individual parameters
function getDatabaseConfig() {
  const databaseUrl = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL

  if (databaseUrl) {
    // Use the full database URL (Neon format)
    return {
      connectionString: databaseUrl,
      ssl: {
        rejectUnauthorized: false, // Required for Neon
      },
    }
  }

  // Fallback to individual parameters for local development
  return {
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT || 5432,
    ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
  }
}

// Create connection pool with optimized settings for Neon
const pool = new Pool({
  ...getDatabaseConfig(),
  // Connection pool settings optimized for serverless/Neon
  max: process.env.NODE_ENV === "production" ? 10 : 5, // Reduced for serverless
  idleTimeoutMillis: 10000, // Shorter idle timeout for serverless
  connectionTimeoutMillis: 10000, // Increased timeout for Neon
  acquireTimeoutMillis: 10000, // Time to wait for connection from pool
  createTimeoutMillis: 10000, // Time to wait for new connection creation
  destroyTimeoutMillis: 5000, // Time to wait for connection destruction
  reapIntervalMillis: 1000, // How often to check for idle connections
  createRetryIntervalMillis: 200, // Retry interval for failed connections
})

// Enhanced error handling for Neon-specific issues
pool.on("error", (err) => {
  console.error("Unexpected database pool error:", err)

  // Log specific Neon connection issues
  if (err.code === "ENOTFOUND") {
    console.error("❌ Neon database host not found. Check your DATABASE_URL")
  } else if (err.code === "ECONNREFUSED") {
    console.error("❌ Connection refused. Neon database may be sleeping or unavailable")
  } else if (err.message.includes("password authentication failed")) {
    console.error("❌ Authentication failed. Check your Neon database credentials")
  }
})

// Enhanced connection testing with Neon-specific diagnostics
async function testConnection() {
  let client
  try {
    console.log("🔄 Testing database connection...")

    // Log connection method being used
    if (process.env.DATABASE_URL || process.env.NEON_DATABASE_URL) {
      console.log("📡 Using Neon database URL connection")
    } else {
      console.log("🏠 Using local database connection parameters")
    }

    client = await pool.connect()

    // Test basic query
    const result = await client.query("SELECT NOW() as current_time, version() as pg_version")
    console.log("✅ Database connection successful")
    console.log(`📅 Server time: ${result.rows[0].current_time}`)
    console.log(`🐘 PostgreSQL version: ${result.rows[0].pg_version.split(" ")[0]}`)

    // Check for essential tables
    const tablesResult = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('users', 'roles', 'clinics', 'appointments')
      ORDER BY table_name
    `)

    const foundTables = tablesResult.rows.map((row) => row.table_name)
    const requiredTables = ["users", "roles", "clinics", "appointments"]
    const missingTables = requiredTables.filter((table) => !foundTables.includes(table))

    if (missingTables.length > 0) {
      console.warn(`⚠️ Missing essential tables: ${missingTables.join(", ")}`)
      console.warn("🔧 Run 'node init-db.js' to initialize the database schema")
      return false
    }

    console.log(`✅ All essential database tables verified: ${foundTables.join(", ")}`)

    // Test connection pool
    const poolInfo = {
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount,
    }
    console.log(`🏊 Connection pool status:`, poolInfo)

    return true
  } catch (err) {
    console.error("❌ Database connection failed:", err.message)

    // Enhanced error diagnostics for Neon
    if (err.code === "ENOTFOUND") {
      console.error("🔍 DNS lookup failed. Check your Neon database URL")
      console.error("💡 Make sure your DATABASE_URL environment variable is set correctly")
    } else if (err.code === "ECONNREFUSED") {
      console.error("🔍 Connection refused. This could mean:")
      console.error("   • Neon database is sleeping (try again in a few seconds)")
      console.error("   • Database URL is incorrect")
      console.error("   • Network connectivity issues")
    } else if (err.code === "28P01") {
      console.error("🔍 Authentication failed. Check your database credentials in the URL")
    } else if (err.code === "3D000") {
      console.error(`🔍 Database does not exist. Check your Neon database name`)
    } else if (err.message.includes("SSL")) {
      console.error("🔍 SSL connection issue. Neon requires SSL connections")
    } else if (err.code === "ETIMEDOUT") {
      console.error("🔍 Connection timeout. Neon database may be slow to respond")
    }

    return false
  } finally {
    if (client) {
      client.release()
    }
  }
}

// Graceful shutdown function for serverless environments
async function closePool() {
  try {
    await pool.end()
    console.log("🔌 Database pool closed successfully")
  } catch (err) {
    console.error("❌ Error closing database pool:", err.message)
  }
}

module.exports = {
  pool,
  testConnection,
  closePool,
  getDatabaseConfig,
}
