const jwt = require("jsonwebtoken")
const { executeQuery } = require("../utils/dbUtils")
const logger = require("./logger")

// Protect middleware - verify JWT token
const protect = async (req, res, next) => {
  try {
    let token

    // Check for token in Authorization header
    if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
      token = req.headers.authorization.split(" ")[1]
    }

    // Check for token in cookies as fallback
    if (!token && req.cookies && req.cookies["auth-token"]) {
      token = req.cookies["auth-token"]
    }

    if (!token) {
      logger.error("No authentication token provided")
      return res.status(401).json({ error: "Not authorized, no token" })
    }

    try {
      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET)

      // Use userId from the token (as generated in authController)
      const userId = decoded.userId || decoded.id

      if (!userId) {
        logger.error("Invalid token payload - no userId or id")
        return res.status(401).json({ error: "Not authorized, invalid token payload" })
      }

      // Get user from database with proper role join
      const result = await executeQuery(
        `
        SELECT u.id, u.email, u.full_name, r.name as role 
        FROM users u 
        LEFT JOIN roles r ON u.role_id = r.id 
        WHERE u.id = $1
      `,
        [userId],
      )

      if (result.rows.length === 0) {
        logger.error(`User not found for ID: ${userId}`)
        return res.status(401).json({ error: "Not authorized, user not found" })
      }

      req.user = {
        ...result.rows[0],
        userId: result.rows[0].id, // Add userId for compatibility
      }

      logger.info(`User authenticated: ${req.user.id} (${req.user.role})`)
      next()
    } catch (error) {
      logger.error(`Token verification error: ${error.message}`)
      return res.status(401).json({ error: "Not authorized, token failed" })
    }
  } catch (error) {
    logger.error(`Auth middleware error: ${error.message}`)
    return res.status(500).json({ error: "Server error in authentication" })
  }
}

// Role-based access control
const role = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Not authorized" })
    }

    if (!roles.includes(req.user.role)) {
      logger.error(`Access denied for user ${req.user.id} (${req.user.role}). Required roles: ${roles.join(", ")}`)
      return res.status(403).json({ error: `Access denied. Required roles: ${roles.join(", ")}` })
    }

    next()
  }
}

// Authorize function (alias for role function)
const authorize = (roles) => {
  return role(roles)
}

module.exports = { protect, role, authorize }
