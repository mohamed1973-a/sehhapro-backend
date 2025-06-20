const rateLimit = require("express-rate-limit")
const logger = require("./logger")

// Significantly increased limits to prevent "too many requests" errors

// For authentication endpoints (login, register)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Allow 1000 requests per 15 minutes (was 5)
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(`Rate limit exceeded for auth: ${req.ip} - ${req.originalUrl}`)
    res.status(429).json({
      error: "Too many authentication attempts. Please try again later.",
    })
  },
})

// For sensitive operations (password reset, email change)
const sensitiveOperationsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 2000, // Allow 2000 requests per 15 minutes (was 10)
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(`Rate limit exceeded for sensitive operation: ${req.ip} - ${req.originalUrl}`)
    res.status(429).json({
      error: "Too many sensitive operations. Please try again later.",
    })
  },
})

// For general API endpoints
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10000, // Allow 10000 requests per minute (was 100)
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(`Rate limit exceeded for API: ${req.ip} - ${req.originalUrl}`)
    res.status(429).json({
      error: "Too many requests. Please try again later.",
    })
  },
})

// For dashboard endpoints (higher limit for better UX)
const dashboardLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 20000, // Allow 20000 requests per minute (was 200)
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(`Rate limit exceeded for dashboard: ${req.ip} - ${req.originalUrl}`)
    res.status(429).json({
      error: "Too many dashboard requests. Please try again later.",
    })
  },
})

// For public endpoints (highest limit)
const publicLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 50000, // Allow 50000 requests per minute (was 500)
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn(`Rate limit exceeded for public endpoint: ${req.ip} - ${req.originalUrl}`)
    res.status(429).json({
      error: "Too many requests to public endpoint. Please try again later.",
    })
  },
})

module.exports = {
  authLimiter,
  sensitiveOperationsLimiter,
  apiLimiter,
  dashboardLimiter,
  publicLimiter,
}
