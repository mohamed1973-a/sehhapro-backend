const app = require("./app")
const { testConnection, closePool } = require("./config/database")
const logger = require("./middleware/logger")

// Function to find an available port
async function findAvailablePort(startPort) {
  const net = require("net")

  return new Promise((resolve) => {
    const server = net.createServer()
    server.listen(startPort, () => {
      const port = server.address().port
      server.close(() => resolve(port))
    })
    server.on("error", () => {
      resolve(findAvailablePort(startPort + 1))
    })
  })
}

async function startServer() {
  try {
    logger.info("🚀 Starting Healthcare Management System Backend...")

    // Test database connection with retry logic for Supabase
    logger.info("🔄 Testing Supabase database connection...")
    let dbConnected = false
    let retries = 3

    while (!dbConnected && retries > 0) {
      dbConnected = await testConnection()

      if (!dbConnected) {
        retries--
        if (retries > 0) {
          logger.warn(`Supabase connection failed, retrying... (${retries} attempts left)`)
          await new Promise((resolve) => setTimeout(resolve, 2000))
        }
      }
    }

    if (!dbConnected) {
      logger.error("❌ Failed to connect to Supabase database after multiple attempts.")
      logger.error("🔍 Please check your Supabase configuration:")

      if (process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL) {
        logger.error("   • Verify your Supabase DATABASE_URL is correct")
        logger.error("   • Get connection string from: https://app.supabase.com/project/YOUR_PROJECT/settings/database")
        logger.error("   • Ensure your Supabase project is not paused")
        logger.error("   • Check your network connectivity")
      } else {
        logger.error("   • Verify your local PostgreSQL is running")
        logger.error("   • Check your DB_* environment variables")
      }

      process.exit(1)
    }

    // Find available port starting from preferred port
    const preferredPort = process.env.PORT || 5000
    const PORT = await findAvailablePort(Number.parseInt(preferredPort))

    if (PORT !== Number.parseInt(preferredPort)) {
      logger.warn(`Port ${preferredPort} is in use, using port ${PORT} instead`)
    }

    // Start the server
    const server = app.listen(PORT, () => {
      logger.info(`✅ Server running on port ${PORT}`)
      logger.info(`📊 Environment: ${process.env.NODE_ENV || "development"}`)
      logger.info(`🔗 API Base URL: http://localhost:${PORT}/api`)
      logger.info(`🔗 Health Check: http://localhost:${PORT}/health`)

      if (process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL) {
        logger.info(`📡 Connected to Supabase Database`)
      } else {
        logger.info(`🏠 Connected to Local PostgreSQL Database`)
      }
    })

    // Handle server errors
    server.on("error", (error) => {
      if (error.code === "EADDRINUSE") {
        logger.error(`❌ Port ${PORT} is already in use`)
        process.exit(1)
      } else {
        logger.error("❌ Server error:", error)
        process.exit(1)
      }
    })

    // Graceful shutdown with database cleanup
    const gracefulShutdown = async (signal) => {
      logger.info(`${signal} received, shutting down gracefully...`)

      // Close server first
      server.close(async () => {
        logger.info("🔌 HTTP server closed")

        // Close database pool
        try {
          await closePool()
          logger.info("✅ Graceful shutdown completed")
          process.exit(0)
        } catch (err) {
          logger.error("❌ Error during shutdown:", err.message)
          process.exit(1)
        }
      })

      // Force close after timeout
      setTimeout(() => {
        logger.error("❌ Forced shutdown due to timeout")
        process.exit(1)
      }, 10000)
    }

    process.on("SIGTERM", () => gracefulShutdown("SIGTERM"))
    process.on("SIGINT", () => gracefulShutdown("SIGINT"))
  } catch (error) {
    logger.error("❌ Failed to start server:", error)
    process.exit(1)
  }
}

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  logger.error("❌ Uncaught Exception:", error)
  process.exit(1)
})

process.on("unhandledRejection", (reason, promise) => {
  logger.error("❌ Unhandled Rejection at:", promise, "reason:", reason)
  process.exit(1)
})

startServer()
