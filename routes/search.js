/**
 * Search Routes
 */
const express = require("express")
const router = express.Router()
const SearchController = require("../controllers/searchController")
const { protect } = require("../middleware/auth")
const { query } = require("express-validator")
const { validate } = require("../middleware/validator")

// Search for patients
router.get(
  "/patients",
  protect,
  [
    query("query").optional().trim(),
    query("phone").optional().trim(),
    query("exact").optional().isBoolean().withMessage("exact must be a boolean"),
  ],
  validate,
  SearchController.searchPatients,
)

// Search for doctors
router.get(
  "/doctors",
  protect,
  [
    query("query").optional().trim(),
    query("specialty").optional().trim(),
    query("license").optional().trim(),
    query("exact").optional().isBoolean().withMessage("exact must be a boolean"),
  ],
  validate,
  SearchController.searchDoctors,
)

// Search for appointments
router.get(
  "/appointments",
  protect,
  [
    query("query").optional().trim(),
    query("date").optional().isISO8601().withMessage("date must be in ISO8601 format (e.g., 2025-03-14)"),
    query("status").optional().isIn(["booked", "completed", "cancelled"]).withMessage("Invalid status"),
    query("type").optional().isIn(["in-person", "telemedicine"]).withMessage("Invalid type"),
  ],
  validate,
  SearchController.searchAppointments,
)

module.exports = router
