/**
 * Logging middleware
 * Configured for development and production environments
 */
const winston = require("winston")
const path = require("path")

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, "..", "logs")
const fs = require("fs")
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true })
}

// Define log format
const logFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.printf((info) => {
    return `${info.timestamp} ${info.level}: ${info.message}${info.stack ? "\n" + info.stack : ""}`
  }),
)

// Configure different transports for development and production
const transports = [
  // Always log errors to file
  new winston.transports.File({
    filename: path.join(logsDir, "error.log"),
    level: "error",
    maxsize: 5242880, // 5MB
    maxFiles: 5,
  }),
  // Combined logs
  new winston.transports.File({
    filename: path.join(logsDir, "combined.log"),
    maxsize: 10485760, // 10MB
    maxFiles: 5,
  }),
]

// Add console transport in development
if (process.env.NODE_ENV !== "production") {
  transports.push(
    new winston.transports.Console({
      format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
    }),
  )
}

// Create the logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: logFormat,
  transports,
  // Don't exit on error
  exitOnError: false,
})

module.exports = logger
