const app = require("./app")
const { testConnection } = require("./config/database")
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
    // Test database connection first
    const dbConnected = await testConnection()
    if (!dbConnected) {
      logger.error("Failed to connect to database. Server will not start.")
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
      logger.info(`🚀 Server running on port ${PORT}`)
      logger.info(`📊 Environment: ${process.env.NODE_ENV || "development"}`)
      logger.info(`🔗 API Base URL: http://localhost:${PORT}/api`)
      logger.info(`🔗 Health Check: http://localhost:${PORT}/health`)
    })

    // Handle server errors
    server.on("error", (error) => {
      if (error.code === "EADDRINUSE") {
        logger.error(`Port ${PORT} is already in use`)
        process.exit(1)
      } else {
        logger.error("Server error:", error)
        process.exit(1)
      }
    })

    // Graceful shutdown
    process.on("SIGTERM", () => {
      logger.info("SIGTERM received, shutting down gracefully")
      server.close(() => {
        logger.info("Process terminated")
        process.exit(0)
      })
    })

    process.on("SIGINT", () => {
      logger.info("SIGINT received, shutting down gracefully")
      server.close(() => {
        logger.info("Process terminated")
        process.exit(0)
      })
    })
  } catch (error) {
    logger.error("Failed to start server:", error)
    process.exit(1)
  }
}

// Handle uncaught exceptions
process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception:", error)
  process.exit(1)
})

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection at:", promise, "reason:", reason)
  process.exit(1)
})

startServer()
