/**
 * Database configuration for PostgreSQL
 * Optimized for Supabase and connection pooling
 */
const { Pool } = require("pg")
require("dotenv").config()

// Parse Supabase database URL if provided, otherwise use individual parameters
function getDatabaseConfig() {
  const databaseUrl = process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL

  if (databaseUrl) {
    // Use the full database URL (Supabase format)
    return {
      connectionString: databaseUrl,
      ssl: {
        rejectUnauthorized: false, // Required for Supabase
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

// Create connection pool with optimized settings for Supabase
const pool = new Pool({
  ...getDatabaseConfig(),
  // Connection pool settings optimized for Supabase
  max: process.env.NODE_ENV === "production" ? 15 : 5, // Supabase handles more connections
  idleTimeoutMillis: 30000, // Standard timeout for Supabase
  connectionTimeoutMillis: 8000, // Supabase connection timeout
  acquireTimeoutMillis: 8000, // Time to wait for connection from pool
  createTimeoutMillis: 8000, // Time to wait for new connection creation
  destroyTimeoutMillis: 5000, // Time to wait for connection destruction
  reapIntervalMillis: 1000, // How often to check for idle connections
  createRetryIntervalMillis: 200, // Retry interval for failed connections
})

// Enhanced error handling for Supabase-specific issues
pool.on("error", (err) => {
  console.error("Unexpected database pool error:", err)

  // Log specific Supabase connection issues
  if (err.code === "ENOTFOUND") {
    console.error("❌ Supabase database host not found. Check your DATABASE_URL")
  } else if (err.code === "ECONNREFUSED") {
    console.error("❌ Connection refused. Check your Supabase database configuration")
  } else if (err.message.includes("password authentication failed")) {
    console.error("❌ Authentication failed. Check your Supabase database credentials")
  } else if (err.message.includes("too many connections")) {
    console.error("❌ Too many connections to Supabase. Consider connection pooling")
  }
})

// Enhanced connection testing with Supabase-specific diagnostics
async function testConnection() {
  let client
  try {
    console.log("🔄 Testing Supabase database connection...")

    // Log connection method being used
    if (process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL) {
      console.log("📡 Using Supabase database URL connection")
    } else {
      console.log("🏠 Using local database connection parameters")
    }

    client = await pool.connect()

    // Test basic query
    const result = await client.query("SELECT NOW() as current_time, version() as pg_version")
    console.log("✅ Supabase database connection successful")
    console.log(`📅 Server time: ${result.rows[0].current_time}`)
    console.log(`🐘 PostgreSQL version: ${result.rows[0].pg_version.split(" ")[0]}`)

    // Check Supabase-specific extensions
    const extensionsResult = await client.query(`
      SELECT extname 
      FROM pg_extension 
      WHERE extname IN ('uuid-ossp', 'pgcrypto', 'pgjwt')
      ORDER BY extname
    `)

    const extensions = extensionsResult.rows.map((row) => row.extname)
    if (extensions.length > 0) {
      console.log(`🔌 Supabase extensions available: ${extensions.join(", ")}`)
    }

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
    console.error("❌ Supabase database connection failed:", err.message)

    // Enhanced error diagnostics for Supabase
    if (err.code === "ENOTFOUND") {
      console.error("🔍 DNS lookup failed. Check your Supabase database URL")
      console.error("💡 Make sure your DATABASE_URL environment variable is set correctly")
      console.error(
        "💡 Get your connection string from: https://app.supabase.com/project/YOUR_PROJECT/settings/database",
      )
    } else if (err.code === "ECONNREFUSED") {
      console.error("🔍 Connection refused. This could mean:")
      console.error("   • Supabase database URL is incorrect")
      console.error("   • Network connectivity issues")
      console.error("   • Supabase project is paused")
    } else if (err.code === "28P01") {
      console.error("🔍 Authentication failed. Check your database credentials in the URL")
      console.error("💡 Make sure you're using the correct password from Supabase dashboard")
    } else if (err.code === "3D000") {
      console.error(`🔍 Database does not exist. Check your Supabase database name`)
    } else if (err.message.includes("SSL")) {
      console.error("🔍 SSL connection issue. Supabase requires SSL connections")
    } else if (err.code === "ETIMEDOUT") {
      console.error("🔍 Connection timeout. Check your network connection to Supabase")
    } else if (err.message.includes("too many connections")) {
      console.error("🔍 Connection limit reached. Supabase has connection limits based on your plan")
    }

    return false
  } finally {
    if (client) {
      client.release()
    }
  }
}

// Graceful shutdown function for Supabase environments
async function closePool() {
  try {
    await pool.end()
    console.log("🔌 Supabase database pool closed successfully")
  } catch (err) {
    console.error("❌ Error closing Supabase database pool:", err.message)
  }
}

module.exports = {
  pool,
  testConnection,
  closePool,
  getDatabaseConfig,
}
