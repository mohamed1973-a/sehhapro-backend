/**
 * Health check routes
 * Provides endpoints for monitoring system health
 */
const express = require("express")
const router = express.Router()
const { testConnection } = require("../config/database")

// Basic health check endpoint
router.get("/", async (req, res) => {
  try {
    // Test database connection
    const dbStatus = await testConnection()

    // Add CORS headers for testing
    if (req.headers["x-cors-test"]) {
      res.header("Access-Control-Allow-Origin", req.headers.origin || "*")
      res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
      res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-CORS-Test")
    }

    // Return health status
    res.json({
      status: "ok",
      database: dbStatus ? "connected" : "disconnected",
      timestamp: new Date().toISOString(),
      version: "2.0.0",
      environment: process.env.NODE_ENV || "development",
      server: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
      },
    })
  } catch (err) {
    console.error("Health check error:", err)
    res.status(500).json({
      status: "error",
      error: err.message,
      timestamp: new Date().toISOString(),
    })
  }
})

// Detailed system status for admin users
router.get("/system", async (req, res) => {
  try {
    // Test database connection
    const dbStatus = await testConnection()

    // Return detailed system information
    res.json({
      status: "ok",
      database: {
        connected: dbStatus,
        host: process.env.DB_HOST,
        name: process.env.DB_NAME,
      },
      server: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
      },
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    console.error("System health check error:", err)
    res.status(500).json({
      status: "error",
      error: err.message,
      timestamp: new Date().toISOString(),
    })
  }
})

// CORS preflight handler for health endpoints
router.options("/", (req, res) => {
  res.header("Access-Control-Allow-Origin", req.headers.origin || "*")
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-CORS-Test")
  res.sendStatus(200)
})

module.exports = router
