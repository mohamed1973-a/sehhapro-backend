const express = require("express")
const router = express.Router()
const { protect, role } = require("../middleware/auth")
const AppointmentController = require("../controllers/appointmentController")
const { body, query, validationResult } = require("express-validator")
const { beginTransaction } = require("../utils/dbUtils")

// Validation middleware
const validate = (req, res, next) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }
  next()
}

// Get today's appointments for a doctor - MUST come before /:id route
router.get("/doctor/today", protect, role(["doctor"]), AppointmentController.getTodayAppointments)

// Get doctor's appointments with optional date filter - MUST come before /:id route
router.get("/doctor", protect, role(["doctor"]), AppointmentController.getDoctorAppointments)

// Get all appointments for the current user
router.get("/", protect, AppointmentController.getAll)

// Get appointment by ID - MUST come after specific routes
router.get("/:id", protect, AppointmentController.getById)

// Create a new appointment (with transaction)
router.post(
  "/",
  protect,
  beginTransaction,
  [
    body("doctorId").isInt().withMessage("Doctor ID must be an integer"),
    // Make clinicId optional for doctors creating in-person appointments
    body("clinicId")
      .optional({ nullable: true })
      .custom((value, { req }) => {
        // If it's telemedicine, clinic should be null
        if (req.body.type === "telemedicine") {
          return true
        }
        // For in-person appointments, allow null if user is a doctor (will be auto-assigned)
        if (req.body.type === "in-person" && req.user && req.user.role === "doctor") {
          return true
        }
        // For patients creating in-person appointments, clinic is required
        if (req.body.type === "in-person" && (!value || value === null)) {
          throw new Error("Clinic ID is required for in-person appointments when booking as a patient")
        }
        // If value is provided, it must be an integer
        if (value !== null && value !== undefined && !Number.isInteger(Number(value))) {
          throw new Error("Clinic ID must be an integer")
        }
        return true
      }),
    body("date").isISO8601().withMessage("Date must be a valid ISO date"),
    body("reason").isLength({ min: 1, max: 500 }).withMessage("Reason must be between 1 and 500 characters"),
    body("type").isIn(["in-person", "telemedicine"]).withMessage("Type must be 'in-person' or 'telemedicine'"),
    body("specialty").optional().isString().withMessage("Specialty must be a string"),
    body("duration").optional().isInt({ min: 15, max: 120 }).withMessage("Duration must be between 15 and 120 minutes"),
    body("patientId").optional().isInt().withMessage("Patient ID must be an integer"),
    body("paymentMethod").optional().isIn(["balance", "cash"]).withMessage("Payment method must be 'balance' or 'cash'"),
    body("appointmentFee").optional().isFloat({ min: 0 }).withMessage("Appointment fee must be a positive number"),
  ],
  validate,
  AppointmentController.create,
)

// Update appointment (with transaction)
router.put(
  "/:id",
  protect,
  beginTransaction,
  [
    body("status").optional().isIn(["booked", "in-progress", "completed", "cancelled"]).withMessage("Invalid status"),
    body("notes").optional().isLength({ max: 1000 }).withMessage("Notes must be less than 1000 characters"),
    body("checkInTime").optional().isISO8601().withMessage("Check-in time must be a valid ISO date"),
    body("checkOutTime").optional().isISO8601().withMessage("Check-out time must be a valid ISO date"),
  ],
  validate,
  AppointmentController.update,
)

// Update appointment notes (with transaction)
router.put(
  "/:id/notes",
  protect,
  beginTransaction,
  [
    body("notes").optional().isLength({ max: 2000 }).withMessage("Notes must be less than 2000 characters"),
    body("outcomes").optional().isLength({ max: 1000 }).withMessage("Outcomes must be less than 1000 characters"),
    body("follow_up_date").optional().isISO8601().withMessage("Follow-up date must be a valid ISO date"),
  ],
  validate,
  AppointmentController.updateNotes,
)

// Get clinic appointments (for clinic admins)
router.get(
  "/clinic",
  protect,
  role(["clinic_admin", "platform_admin"]),
  [query("clinicId").optional().isInt().withMessage("Clinic ID must be an integer")],
  validate,
  AppointmentController.getClinicAppointments,
)

// Get clinic appointment statistics
router.get(
  "/clinic/stats",
  protect,
  role(["clinic_admin", "platform_admin"]),
  [query("clinicId").optional().isInt().withMessage("Clinic ID must be an integer")],
  validate,
  AppointmentController.getClinicStats,
)

// Get clinic appointment statistics by clinic ID
router.get(
  "/clinic/:id/stats",
  protect,
  role(["clinic_admin", "platform_admin"]),
  [query("clinicId").optional().isInt().withMessage("Clinic ID must be an integer")],
  validate,
  AppointmentController.getClinicStatsByClinicId,
)

// Start telemedicine session (with transaction)
router.post("/:id/telemedicine/start", protect, beginTransaction, AppointmentController.startTelemedicineSession)

// End telemedicine session (with transaction)
router.post(
  "/:id/telemedicine/end",
  protect,
  role(["doctor"]),
  beginTransaction,
  [
    body("notes").optional().isLength({ max: 1000 }).withMessage("Notes must be less than 1000 characters"),
    body("sessionSummary")
      .optional()
      .isLength({ max: 2000 })
      .withMessage("Session summary must be less than 2000 characters"),
  ],
  validate,
  AppointmentController.endTelemedicineSession,
)

// Check-in for appointment (with transaction)
router.post("/:id/checkin", protect, beginTransaction, AppointmentController.checkIn)

// Check-out for appointment (with transaction)
router.post(
  "/:id/checkout",
  protect,
  role(["doctor", "nurse"]),
  beginTransaction,
  [body("notes").optional().isLength({ max: 1000 }).withMessage("Notes must be less than 1000 characters")],
  validate,
  AppointmentController.checkOut,
)

// Cancel appointment (with transaction)
router.post("/:id/cancel", protect, beginTransaction, AppointmentController.cancel)

// Reschedule appointment (with transaction)
router.post(
  "/:id/reschedule",
  protect,
  beginTransaction,
  [
    body("newDate").isISO8601().withMessage("New date must be a valid ISO date"),
    body("reason").optional().isLength({ max: 500 }).withMessage("Reason must be less than 500 characters"),
  ],
  validate,
  AppointmentController.reschedule,
)

module.exports = router
