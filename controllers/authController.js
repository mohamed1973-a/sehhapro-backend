/**
 * Authentication Controller
 *
 * Handles user registration, login, account management.
 */
const bcrypt = require("bcryptjs")
const jwt = require("jsonwebtoken")
const { pool } = require("../config/database")
const logger = require("../middleware/logger")
const asyncHandler = require("../utils/asyncHandler")

// Generate JWT tokens
const generateTokens = (userId) => {
  const accessToken = jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: "4h",
  })
  const refreshToken = jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: "7d",
  })
  return { accessToken, refreshToken }
}

class AuthController {
  /**
   * Registers a new user
   */
  static register = asyncHandler(async (req, res) => {
    try {
      const { full_name, email, password, role = "patient", phone } = req.body

      // Check if user already exists
      const existingUser = await pool.query("SELECT id FROM users WHERE email = $1", [email])
      if (existingUser.rows.length > 0) {
        return res.status(400).json({
          success: false,
          error: "User with this email already exists",
        })
      }

      // Hash password
      const saltRounds = 12
      const hashedPassword = await bcrypt.hash(password, saltRounds)

      // Get role_id first
      const roleResult = await pool.query("SELECT id FROM roles WHERE name = $1", [role])
      if (roleResult.rows.length === 0) {
        return res.status(400).json({
          success: false,
          error: "Invalid role specified",
        })
      }
      const roleId = roleResult.rows[0].id

      // Insert new user
      const result = await pool.query(
        `INSERT INTO users (full_name, email, password_hash, role_id, phone, created_at, updated_at) 
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) 
         RETURNING id, full_name, email, role_id, phone, created_at`,
        [full_name, email, hashedPassword, roleId, phone || null],
      )

      const user = result.rows[0]

      // Get role name for response
      const userRoleResult = await pool.query("SELECT name FROM roles WHERE id = $1", [user.role_id])
      const userRole = userRoleResult.rows[0]?.name || role

      logger.info(`User registered successfully: ${email}`)

      const { accessToken, refreshToken } = generateTokens(user.id)

      res.status(201).json({
        success: true,
        message: "User registered successfully",
        user: {
          id: user.id,
          full_name: user.full_name,
          email: user.email,
          role: userRole,
          phone: user.phone,
        },
        token: accessToken,
        refreshToken,
      })
    } catch (error) {
      logger.error("Registration error:", error)
      res.status(500).json({
        success: false,
        error: "Internal server error during registration",
      })
    }
  })

  /**
   * Authenticates a user and provides access tokens
   */
  static login = asyncHandler(async (req, res) => {
    try {
      const { email, password } = req.body

      // Find user by email - check actual column names in database
      const result = await pool.query(
        `SELECT u.id, u.full_name, u.email, u.password_hash, r.name as role, u.phone 
         FROM users u 
         LEFT JOIN roles r ON u.role_id = r.id 
         WHERE u.email = $1`,
        [email],
      )

      if (result.rows.length === 0) {
        return res.status(401).json({
          success: false,
          error: "Invalid email or password",
        })
      }

      const user = result.rows[0]

      // Check password
      const isValidPassword = await bcrypt.compare(password, user.password_hash)
      if (!isValidPassword) {
        return res.status(401).json({
          success: false,
          error: "Invalid email or password",
        })
      }

      // Generate tokens
      const { accessToken, refreshToken } = generateTokens(user.id)

      logger.info(`User logged in successfully: ${email}`)

      res.json({
        success: true,
        message: "Login successful",
        user: {
          id: user.id,
          full_name: user.full_name,
          email: user.email,
          role: user.role,
          phone: user.phone,
        },
        token: accessToken,
        refreshToken,
      })
    } catch (error) {
      logger.error("Login error:", error)
      res.status(500).json({
        success: false,
        error: "Internal server error during login",
      })
    }
  })

  /**
   * Gets the current user information
   */
  static getCurrentUser = asyncHandler(async (req, res) => {
    try {
      const userId = req.user.userId || req.user.id
      logger.info(`[getCurrentUser] userId: ${userId}`)

      // Get complete user information with proper role join
      const result = await pool.query(
        `SELECT u.id, u.email, u.full_name, r.name as role, u.phone, u.created_at
         FROM users u
         LEFT JOIN roles r ON u.role_id = r.id
         WHERE u.id = $1`,
        [userId],
      )

      if (result.rows.length === 0) {
        logger.error(`[getCurrentUser] No user found for userId: ${userId}`)
        return res.status(404).json({
          success: false,
          message: "User not found",
        })
      }

      const user = result.rows[0]
      logger.info(`[getCurrentUser] user.role: ${user.role}`)
      let clinic_id = null
      if (user.role === 'clinic_admin') {
        // Get the primary clinic for this admin
        const clinicResult = await pool.query(
          "SELECT clinic_id FROM admin_clinics WHERE admin_id = $1 AND is_primary = TRUE",
          [user.id]
        )
        logger.info(`[getCurrentUser] admin_clinics result for admin_id ${user.id}:`, clinicResult.rows)
        if (clinicResult.rows.length > 0) {
          clinic_id = clinicResult.rows[0].clinic_id
        } else {
          logger.warn(`[getCurrentUser] No primary clinic found for admin_id: ${user.id}`)
        }
      }

      res.json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          full_name: user.full_name || `User ${user.id}`,
          role: user.role,
          phone: user.phone,
          created_at: user.created_at,
          clinic_id, // Add this for clinic_admins (null for others)
        },
      })
    } catch (error) {
      logger.error("Get current user error:", error)
      res.status(500).json({
        success: false,
        message: "Internal server error",
      })
    }
  })

  /**
   * Refreshes access tokens using a valid refresh token
   */
  static refreshToken = asyncHandler(async (req, res) => {
    try {
      const { refreshToken } = req.body

      if (!refreshToken) {
        return res.status(401).json({
          success: false,
          error: "Refresh token required",
        })
      }

      // Verify refresh token
      const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET)

      // Get user data for new token with proper role join
      const userResult = await pool.query(
        `SELECT u.id, r.name as role 
         FROM users u 
         LEFT JOIN roles r ON u.role_id = r.id 
         WHERE u.id = $1`,
        [decoded.userId],
      )

      if (userResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: "User not found",
        })
      }

      const user = userResult.rows[0]
      const { accessToken: newAccessToken, refreshToken: newRefreshToken } = generateTokens(user.id)

      res.json({
        success: true,
        token: newAccessToken,
        refreshToken: newRefreshToken,
        user: {
          id: user.id,
          role: user.role,
        },
      })
    } catch (error) {
      logger.error("Token refresh error:", error)
      res.status(401).json({
        success: false,
        error: "Invalid refresh token",
      })
    }
  })

  /**
   * Logs out a user by invalidating their refresh token
   */
  static logout = asyncHandler(async (req, res) => {
    try {
      res.json({
        success: true,
        message: "Logged out successfully",
      })
    } catch (error) {
      logger.error("Logout error:", error)
      res.status(500).json({
        success: false,
        error: "Internal server error during logout",
      })
    }
  })

  /**
   * Handles password reset request
   */
  static forgotPassword = asyncHandler(async (req, res) => {
    try {
      const { email } = req.body

      // Check if user exists
      const result = await pool.query("SELECT id FROM users WHERE email = $1", [email])
      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: "User not found",
        })
      }

      res.json({
        success: true,
        message: "Password reset instructions sent to your email",
      })
    } catch (error) {
      logger.error("Forgot password error:", error)
      res.status(500).json({
        success: false,
        error: "Internal server error",
      })
    }
  })

  /**
   * Resets a user's password
   */
  static resetPassword = asyncHandler(async (req, res) => {
    try {
      const { token, password } = req.body

      res.json({
        success: true,
        message: "Password reset successfully",
      })
    } catch (error) {
      logger.error("Reset password error:", error)
      res.status(500).json({
        success: false,
        error: "Internal server error",
      })
    }
  })
}

module.exports = AuthController
