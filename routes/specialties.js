const express = require("express")
const router = express.Router()
const SpecialtyController = require("../controllers/specialtyController")
const asyncHandler = require("../utils/asyncHandler")

/**
 * @route   GET /api/specialties
 * @desc    Get all specialties with doctor counts
 * @access  Public
 * @query   clinic_id - Optional filter by clinic
 * @query   appointment_type - Optional filter by appointment type (in-person/telemedicine)
 */
router.get("/", asyncHandler(SpecialtyController.getAll))

module.exports = router
