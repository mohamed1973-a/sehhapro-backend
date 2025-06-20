const express = require("express")
const router = express.Router()
const { pool } = require("../config/database")
const logger = require("../middleware/logger")
const { protect } = require("../middleware/auth")

// @route   GET api/labs/results/:patientId
// @desc    Get lab results for a specific patient
// @access  Private
router.get("/results/:patientId", protect, async (req, res) => {
  try {
    const { patientId } = req.params

    const result = await pool.query(
      `SELECT lr.*, u.full_name as patient_name, d.full_name as doctor_name, c.name as clinic_name
       FROM lab_requests lr
       JOIN users u ON lr.patient_id = u.id
       JOIN users d ON lr.doctor_id = d.id
       JOIN clinics c ON lr.lab_clinic_id = c.id
       WHERE lr.patient_id = $1 AND lr.result_file IS NOT NULL
       ORDER BY lr.updated_at DESC`,
      [patientId],
    )

    res.json(result.rows)
  } catch (err) {
    logger.error(`Get lab results error: ${err.message}`)
    res.status(500).json({ error: "Server error", details: err.message })
  }
})

module.exports = router
