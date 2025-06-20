/**
 * Enhanced error handling middleware
 * Provides detailed error responses for development
 * and sanitized responses for production
 */
const logger = require("./logger")

module.exports = (err, req, res, next) => {
  // Log the error with stack trace
  logger.error(`Error: ${err.message}, Stack: ${err.stack}`)

  // Determine if we're in development mode
  const isDevelopment = process.env.NODE_ENV !== "production"

  // Handle specific error types
  if (err.name === "ValidationError") {
    return res.status(400).json({
      error: "Validation Error",
      details: isDevelopment ? err.message : "Invalid input data",
    })
  }

  if (err.name === "UnauthorizedError" || err.message.includes("unauthorized")) {
    return res.status(401).json({
      error: "Authentication Error",
      details: "Invalid or expired authentication credentials",
    })
  }

  if (err.name === "ForbiddenError" || err.message.includes("forbidden")) {
    return res.status(403).json({
      error: "Forbidden",
      details: "You don't have permission to access this resource",
    })
  }

  // Database errors
  if (err.code && err.code.startsWith("23")) {
    // PostgreSQL constraint violations
    return res.status(400).json({
      error: "Database Constraint Error",
      details: isDevelopment ? err.detail || err.message : "Database constraint violation",
    })
  }

  if (err.code === "42P01") {
    // Table doesn't exist
    return res.status(500).json({
      error: "Database Schema Error",
      details: isDevelopment ? "Table does not exist" : "Database configuration error",
    })
  }

  // Default error response
  res.status(500).json({
    error: "Internal Server Error",
    details: isDevelopment ? err.message : "An unexpected error occurred",
    requestId: req.id, // Assuming you have request ID middleware
  })
}
