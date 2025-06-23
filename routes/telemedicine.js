const express = require("express")
const router = express.Router()
const TelemedicineController = require("../controllers/telemedicineController")
const { protect, role } = require("../middleware/auth")
const { body, param } = require("express-validator")
const { validate } = require("../middleware/validator")

// Get all telemedicine sessions for user
router.get("/", protect, TelemedicineController.getAll)

// Get telemedicine session by ID
router.get(
  "/:id",
  protect,
  [param("id").isInt().withMessage("Session ID must be an integer")],
  validate,
  TelemedicineController.getById,
)

// Create standalone telemedicine session (deprecated - use appointments API)
router.post(
  "/",
  protect,
  role(["patient"]),
  [
    body("specialty").notEmpty().withMessage("Specialty is required"),
    body("date").isISO8601().withMessage("Valid date is required"),
    body("reason").optional().isString().withMessage("Reason must be a string"),
    body("doctorId").optional().isInt().withMessage("Doctor ID must be an integer"),
  ],
  validate,
  TelemedicineController.createStandalone,
)

// Update telemedicine session
router.put(
  "/:id",
  protect,
  [
    param("id").isInt().withMessage("Session ID must be an integer"),
    body("status")
      .optional()
      .isIn(["scheduled", "in-progress", "completed", "cancelled"])
      .withMessage("Invalid status value"),
    body("notes").optional().isString().withMessage("Notes must be a string"),
    body("sessionSummary").optional().isString().withMessage("Session summary must be a string"),
  ],
  validate,
  TelemedicineController.update,
)

// Start telemedicine session (for existing sessions)
router.post(
  "/:id/start",
  protect,
  role(["doctor", "patient"]),
  [param("id").isInt().withMessage("Session ID must be an integer")],
  validate,
  TelemedicineController.start,
)

// End telemedicine session
router.post(
  "/:id/end",
  protect,
  role(["doctor"]),
  [
    param("id").isInt().withMessage("Session ID must be an integer"),
    body("notes").optional().isString().withMessage("Notes must be a string"),
    body("sessionSummary").optional().isString().withMessage("Session summary must be a string"),
  ],
  validate,
  TelemedicineController.end,
)

// Join telemedicine session
router.post(
  "/:id/join",
  protect,
  role(["doctor", "patient"]),
  [param("id").isInt().withMessage("Session ID must be an integer")],
  validate,
  TelemedicineController.join,
)

// Leave telemedicine session
router.post(
  "/:id/leave",
  protect,
  role(["doctor", "patient"]),
  [param("id").isInt().withMessage("Session ID must be an integer")],
  validate,
  TelemedicineController.leave,
)

// Get session messages
router.get(
  "/:id/messages",
  protect,
  [param("id").isInt().withMessage("Session ID must be an integer")],
  validate,
  TelemedicineController.getMessages,
)

// Send message in session
router.post(
  "/:id/messages",
  protect,
  [
    param("id").isInt().withMessage("Session ID must be an integer"),
    body("message").notEmpty().withMessage("Message is required"),
    body("type").optional().isIn(["text", "file", "image"]).withMessage("Invalid message type"),
  ],
  validate,
  TelemedicineController.sendMessage,
)

// Get telemedicine session by appointment ID
router.get(
  "/appointment/:appointmentId",
  protect,
  role(["doctor", "patient"]),
  [param("appointmentId").isInt().withMessage("Appointment ID must be an integer")],
  validate,
  TelemedicineController.getByAppointmentId,
)

module.exports = router
