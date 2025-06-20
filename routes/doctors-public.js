/**
 * Public Doctor Routes
 * This file contains routes that can be accessed by all authenticated users,
 * not just admins.
 */
const express = require("express")
const router = express.Router()
const { pool } = require("../config/database")
const { protect } = require("../middleware/auth")
const logger = require("../middleware/logger")

// Get all doctors (accessible to all authenticated users)
router.get("/", protect, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT u.id, u.full_name, u.email, dp.specialty, dp.years_experience, dp.available_for_telemedicine FROM users u JOIN roles r ON u.role_id = r.id LEFT JOIN doctor_portfolios dp ON u.id = dp.doctor_id WHERE r.name = 'doctor' ORDER BY u.full_name",
    )
    logger.info("All doctors retrieved (public endpoint)")
    res.status(200).json(result.rows)
  } catch (err) {
    logger.error(`Get all doctors error (public endpoint): ${err.message}`)
    res.status(500).json({ error: "Server error", details: err.message })
  }
})

module.exports = router
