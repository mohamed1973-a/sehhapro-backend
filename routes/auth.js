const express = require("express")
const router = express.Router()
const AuthController = require("../controllers/authController")
const { body } = require("express-validator")
const { validate } = require("../middleware/validator")
const { protect } = require("../middleware/auth")

// Register a new user
router.post(
  "/register",
  [
    body("full_name").notEmpty().withMessage("Full name required"),
    body("email").isEmail().withMessage("Valid email required"),
    body("password").isLength({ min: 6 }).withMessage("Password must be at least 6 characters"),
    body("role")
      .optional()
      .isIn(["patient", "doctor", "clinic_admin", "lab_admin", "platform_admin", "lab", "nurse"])
      .withMessage("Invalid role"),
    body("clinicId").optional().isInt().withMessage("Clinic ID must be an integer"),
    body("phone").optional().isString().withMessage("Phone must be a string"),
  ],
  validate,
  AuthController.register,
)

// Login user and get tokens
router.post(
  "/login",
  [
    body("email").isEmail().withMessage("Valid email required"),
    body("password").notEmpty().withMessage("Password required"),
  ],
  validate,
  AuthController.login,
)

// Get new tokens using refresh token
router.post(
  "/refresh-token",
  [body("refreshToken").notEmpty().withMessage("Refresh token required")],
  validate,
  AuthController.refreshToken,
)

// Request password reset
router.post(
  "/forgot-password",
  [body("email").isEmail().withMessage("Valid email required")],
  validate,
  AuthController.forgotPassword,
)

// Complete password reset
router.post(
  "/reset-password",
  [
    body("token").notEmpty().withMessage("Token required"),
    body("password").isLength({ min: 6 }).withMessage("Password must be at least 6 characters"),
  ],
  validate,
  AuthController.resetPassword,
)

// Logout and invalidate refresh token
router.post(
  "/logout",
  [body("refreshToken").notEmpty().withMessage("Refresh token required")],
  validate,
  AuthController.logout,
)

// Protected route to get current user
router.get("/me", protect, async (req, res) => {
  try {
    res.json({
      success: true,
      user: {
        id: req.user.id,
        email: req.user.email,
        full_name: req.user.full_name,
        role: req.user.role,
        clinic_id: req.user.clinic_id,
        phone: req.user.phone,
      },
    })
  } catch (error) {
    console.error("Get user info error:", error)
    res.status(500).json({
      success: false,
      error: "Failed to get user information",
    })
  }
})

module.exports = router
