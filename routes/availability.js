const express = require("express")
const router = express.Router()
const { protect, role } = require("../middleware/auth")
const AvailabilityController = require("../controllers/availabilityController")
const { body, query, validationResult } = require("express-validator")
const { executeQuery } = require("../utils/dbUtils")
const logger = require("../middleware/logger")

// Validation middleware
const validate = (req, res, next) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }
  next()
}

// Public route to get availability (for appointment booking)
router.get("/public", async (req, res) => {
  try {
    const { doctor_id, date, appointment_type } = req.query

    console.log("Public availability request:", { doctor_id, date, appointment_type })

    if (!doctor_id || !date) {
      return res.status(400).json({ error: "doctor_id and date are required" })
    }

    // Parse and validate the requested date
    const requestedDate = new Date(date)
    if (isNaN(requestedDate.getTime())) {
      return res.status(400).json({ error: "Invalid date format" })
    }

    // Check if the requested date is in the past
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    requestedDate.setHours(0, 0, 0, 0)

    if (requestedDate < today) {
      console.log(`Requested date ${requestedDate.toISOString()} is in the past`)
      return res.status(200).json([])
    }

    console.log("Fetching real availability slots for date:", requestedDate.toISOString().split("T")[0])

    // Get ONLY existing availability slots created by doctors/admins for the EXACT date
    let query = `
      SELECT a.*, u.full_name AS provider_name, c.name AS clinic_name 
      FROM availability_slots a 
      JOIN users u ON a.provider_id = u.id 
      LEFT JOIN clinics c ON a.clinic_id = c.id 
      WHERE a.provider_id = $1 
      AND a.provider_type = 'doctor'
      AND a.is_available = TRUE
      AND DATE(a.start_time) = DATE($2)
    `

    const params = [doctor_id, date]

    // Add clinic filter for appointment type
    if (appointment_type === "in-person") {
      query += ` AND a.clinic_id IS NOT NULL`
    } else if (appointment_type === "telemedicine") {
      query += ` AND a.clinic_id IS NULL`
    }

    // Check for existing appointments that would make slots unavailable
    query += ` AND NOT EXISTS (
      SELECT 1 FROM appointments ap 
      WHERE ap.slot_id = a.id 
      AND ap.status IN ('booked', 'in-progress', 'completed')
    )`

    query += ` ORDER BY a.start_time`

    const result = await executeQuery(query, params)
    console.log(`Found ${result.rows.length} real availability slots for ${date}`)

    // Filter out slots that are in the past for today
    const now = new Date()
    const isToday = requestedDate.toDateString() === now.toDateString()

    let availableSlots = result.rows
    if (isToday) {
      availableSlots = result.rows.filter((slot) => new Date(slot.start_time) > now)
      console.log(`Filtered to ${availableSlots.length} future slots for today`)
    }

    // Return only real slots created by doctors/admins
    res.status(200).json(availableSlots)
  } catch (error) {
    console.error("Error fetching public availability:", error)
    res.status(500).json({ error: "Server error", details: error.message })
  }
})

// Get availability slots (protected)
router.get(
  "/",
  protect,
  [
    query("providerId").optional().isInt().withMessage("Provider ID must be an integer"),
    query("providerType").optional().isIn(["doctor", "lab", "nurse"]).withMessage("Invalid provider type"),
    query("clinicId").optional().isInt().withMessage("Clinic ID must be an integer"),
    query("startDate").optional().isISO8601().withMessage("Start date must be a valid ISO date"),
    query("endDate").optional().isISO8601().withMessage("End date must be a valid ISO date"),
    query("available").optional().isBoolean().withMessage("Available must be a boolean"),
  ],
  validate,
  AvailabilityController.getAll,
)

// Create availability slot with overlap prevention
router.post(
  "/",
  protect,
  role(["doctor", "lab", "nurse", "clinic_admin", "lab_admin", "platform_admin"]),
  [
    body("clinicId").optional().isInt().withMessage("Clinic ID must be an integer"),
    body("startTime").optional().isISO8601().withMessage("Start time must be a valid ISO date"),
    body("endTime").optional().isISO8601().withMessage("End time must be a valid ISO date"),
    body("providerType").optional().isIn(["doctor", "lab", "nurse"]).withMessage("Invalid provider type"),
    body("recurring").optional().isObject().withMessage("Recurring must be an object"),
    body("recurring.pattern").optional().isIn(["daily", "weekly", "monthly"]).withMessage("Invalid recurring pattern"),
    body("recurring.startDate").optional().isISO8601().withMessage("Start date must be a valid ISO date"),
    body("recurring.endDate").optional().isISO8601().withMessage("End date must be a valid ISO date"),
    body("recurring.daysOfWeek").optional().isArray().withMessage("Days of week must be an array"),
    body("recurring.dailyStartTime")
      .optional()
      .matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
      .withMessage("Daily start time must be in HH:MM format"),
    body("recurring.dailyEndTime")
      .optional()
      .matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
      .withMessage("Daily end time must be in HH:MM format"),
    body("recurring.slotDuration")
      .optional()
      .isInt({ min: 15, max: 240 })
      .withMessage("Slot duration must be between 15 and 240 minutes"),
    body("labTechId").optional().isInt().withMessage("Lab technician ID must be an integer"),
    body("isTelemedicine").optional().isBoolean().withMessage("isTelemedicine must be a boolean"),
  ],
  validate,
  AvailabilityController.create,
)

// Delete availability slot
router.delete("/:id", protect, AvailabilityController.delete)

// Update availability slot
router.put(
  "/:id",
  protect,
  [
    body("startTime").optional().isISO8601().withMessage("Start time must be a valid ISO date"),
    body("endTime").optional().isISO8601().withMessage("End time must be a valid ISO date"),
    body("isAvailable").optional().isBoolean().withMessage("isAvailable must be a boolean"),
  ],
  validate,
  AvailabilityController.update,
)

module.exports = router
