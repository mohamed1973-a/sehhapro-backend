/**
 * User Statistics Routes
 */
const express = require("express")
const router = express.Router()
const UserStatsController = require("../controllers/userStatsController")
const auth = require("../middleware/auth")
const role = require("../middleware/role")

// Get user statistics by ID (Platform Admin only)
router.get("/:id/stats", auth, role(["platform_admin"]), UserStatsController.getUserStats)

module.exports = router
