/**
 * Async handler utility to eliminate try/catch repetition
 * Enhanced with better error handling and transaction management
 */
const logger = require("../middleware/logger")

/**
 * Wraps an async controller function to handle errors consistently
 * Automatically handles transaction rollback if an error occurs
 *
 * @param {Function} fn - The async controller function to wrap
 * @returns {Function} - Express middleware function
 */
const asyncHandler = (fn) => async (req, res, next) => {
  try {
    await fn(req, res, next)
  } catch (err) {
    // Log the error with context
    logger.error(`Error in ${fn.name || "anonymous function"}: ${err.message}`)
    logger.error(`Request path: ${req.path}, Method: ${req.method}`)

    if (process.env.NODE_ENV !== "production") {
      console.error(err.stack)
    }

    // Handle database transaction errors
    if (req.dbTransaction) {
      try {
        await req.dbTransaction.rollback()
        logger.info("Transaction rolled back due to error")
      } catch (rollbackErr) {
        logger.error(`Rollback error: ${rollbackErr.message}`)
      }
    }

    // Determine appropriate status code based on error
    let statusCode = 500
    const errorMessage = process.env.NODE_ENV === "production" ? "An unexpected error occurred" : err.message

    // Handle specific error types
    if (err.message.includes("not found") || err.message.includes("does not exist")) {
      statusCode = 404
    } else if (err.message.includes("duplicate") || err.message.includes("already exists")) {
      statusCode = 409
    } else if (err.message.includes("invalid") || err.message.includes("required")) {
      statusCode = 400
    } else if (err.message.includes("unauthorized") || err.message.includes("authentication")) {
      statusCode = 401
    } else if (err.message.includes("forbidden") || err.message.includes("permission")) {
      statusCode = 403
    }

    // Send error response
    res.status(statusCode).json({
      error: statusCode === 500 ? "Server error" : "Request error",
      message: errorMessage,
      code: err.code, // Include database error code if available
    })
  }
}

module.exports = asyncHandler
