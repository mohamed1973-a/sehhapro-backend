/**
 * User Routes
 */
const express = require("express")
const router = express.Router()
const UserController = require("../controllers/userController")
const { protect, authorize } = require("../middleware/auth")

// User profile routes (for current user) - these should come first
router.get("/profile", protect, UserController.getProfile)
router.put("/profile", protect, UserController.updateProfile)

// Platform admin routes for user management
router.get("/", protect, authorize(["platform_admin"]), UserController.getAllUsers)
router.post("/", protect, authorize(["platform_admin"]), UserController.createUser)
router.get("/:id", protect, authorize(["platform_admin"]), UserController.getUserById)
router.put("/:id", protect, authorize(["platform_admin"]), UserController.updateUser)
router.patch("/:id", protect, authorize(["platform_admin"]), UserController.updateUser)
router.delete("/:id", protect, authorize(["platform_admin"]), UserController.deleteUser)

module.exports = router
