const path = require("path")
require("dotenv").config({ path: path.join(__dirname, "../.env") })

// Required environment variables
const requiredEnvVars = ["JWT_SECRET", "JWT_REFRESH_SECRET"]

// Check for missing environment variables
const missingEnvVars = requiredEnvVars.filter((envVar) => !process.env[envVar])

if (missingEnvVars.length > 0) {
  console.error("Missing required environment variables:", missingEnvVars)
  console.log("Please create a .env file in the backend directory with the following variables:")
  console.log("JWT_SECRET=your_jwt_secret_here")
  console.log("JWT_REFRESH_SECRET=your_jwt_refresh_secret_here")
  console.log("")
  console.log("For Neon Database (Production):")
  console.log("DATABASE_URL=postgresql://username:password@ep-xxx-xxx.region.aws.neon.tech/dbname?sslmode=require")
  console.log("")
  console.log("For Local Development:")
  console.log("DB_USER=your_db_user")
  console.log("DB_HOST=localhost")
  console.log("DB_NAME=healthcare_db")
  console.log("DB_PASSWORD=your_db_password")
  console.log("DB_PORT=5432")
  console.log("")
  console.log("Other variables:")
  console.log("FRONTEND_URL=http://localhost:3000")
  console.log("PORT=5000")
  console.log("Using default values for development...")

  // Set default values for development
  process.env.JWT_SECRET = process.env.JWT_SECRET || "default-jwt-secret-for-development-only-change-in-production"
  process.env.JWT_REFRESH_SECRET =
    process.env.JWT_REFRESH_SECRET || "default-refresh-secret-for-development-only-change-in-production"
}

// Set other defaults
process.env.FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000"
process.env.PORT = process.env.PORT || "5000"
process.env.NODE_ENV = process.env.NODE_ENV || "development"

// Database configuration - support both Neon URL and individual parameters
const databaseUrl = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL

if (databaseUrl) {
  console.log("📡 Using Neon database URL for connection")
} else {
  console.log("🏠 Using individual database parameters for connection")
  // Set defaults for local development
  process.env.DB_USER = process.env.DB_USER || "postgres"
  process.env.DB_HOST = process.env.DB_HOST || "localhost"
  process.env.DB_NAME = process.env.DB_NAME || "healthcare_db"
  process.env.DB_PASSWORD = process.env.DB_PASSWORD || "password"
  process.env.DB_PORT = process.env.DB_PORT || "5432"
  process.env.DB_SSL = process.env.DB_SSL || "false"
}

// Export configuration
module.exports = {
  JWT_SECRET: process.env.JWT_SECRET,
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
  DATABASE_URL: process.env.DATABASE_URL,
  NEON_DATABASE_URL: process.env.NEON_DATABASE_URL,
  DB_USER: process.env.DB_USER,
  DB_HOST: process.env.DB_HOST,
  DB_NAME: process.env.DB_NAME,
  DB_PASSWORD: process.env.DB_PASSWORD,
  DB_PORT: process.env.DB_PORT,
  DB_SSL: process.env.DB_SSL,
  FRONTEND_URL: process.env.FRONTEND_URL,
  PORT: process.env.PORT,
  NODE_ENV: process.env.NODE_ENV,
}
