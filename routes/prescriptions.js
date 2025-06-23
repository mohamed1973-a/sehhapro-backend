const express = require("express")
const router = express.Router()
const PrescriptionController = require("../controllers/prescriptionController")
const { protect, role } = require("../middleware/auth")
const { body, param, query } = require("express-validator")
const { validate } = require("../middleware/validator")
const transactionMiddleware = require("../middleware/transactionMiddleware")

// Validation schemas
const createPrescriptionValidation = [
  body("patient_id").isInt().withMessage("Patient ID must be an integer"),
  body("diagnosis").notEmpty().withMessage("Diagnosis is required"),
  body("medications").isArray({ min: 1 }).withMessage("At least one medication is required"),
  body("medications.*.name").notEmpty().withMessage("Medication name is required"),
  body("medications.*.dosage").notEmpty().withMessage("Medication dosage is required"),
  body("medications.*.frequency").notEmpty().withMessage("Medication frequency is required"),
  body("medications.*.duration").notEmpty().withMessage("Medication duration is required"),
  body("medications.*.instructions").notEmpty().withMessage("Medication instructions are required"),
  body("medications.*.quantity").isInt({ min: 1 }).withMessage("Medication quantity must be a positive integer"),
  body("appointment_id").optional().isInt().withMessage("Appointment ID must be an integer"),
  body("clinic_id").optional().isInt().withMessage("Clinic ID must be an integer"),
  body("notes").optional().isString().withMessage("Notes must be a string"),
  body("follow_up_date").optional().isISO8601().withMessage("Follow-up date must be a valid date"),
  body("refills_remaining").optional().isInt({ min: 0 }).withMessage("Refills must be a non-negative integer"),
]

const updatePrescriptionValidation = [
  param("id").isInt().withMessage("Prescription ID must be an integer"),
  body("diagnosis").optional().notEmpty().withMessage("Diagnosis cannot be empty"),
  body("medications").optional().isArray({ min: 1 }).withMessage("At least one medication is required"),
  body("medications.*.name").optional().notEmpty().withMessage("Medication name is required"),
  body("medications.*.dosage").optional().notEmpty().withMessage("Medication dosage is required"),
  body("medications.*.frequency").optional().notEmpty().withMessage("Medication frequency is required"),
  body("medications.*.duration").optional().notEmpty().withMessage("Medication duration is required"),
  body("medications.*.instructions").optional().notEmpty().withMessage("Medication instructions are required"),
  body("medications.*.quantity")
    .optional()
    .isInt({ min: 1 })
    .withMessage("Medication quantity must be a positive integer"),
  body("status").optional().isIn(["active", "completed", "cancelled", "expired"]).withMessage("Invalid status"),
  body("notes").optional().isString().withMessage("Notes must be a string"),
  body("follow_up_date").optional().isISO8601().withMessage("Follow-up date must be a valid date"),
  body("refills_remaining").optional().isInt({ min: 0 }).withMessage("Refills must be a non-negative integer"),
]

// =====================================================
// MAIN PRESCRIPTION ROUTES
// =====================================================

/**
 * @route   GET /api/prescriptions/stats
 * @desc    Get prescription statistics
 * @access  Private
 */
router.get("/stats", protect, PrescriptionController.getStats)

/**
 * @route   GET /api/prescriptions
 * @desc    Get all prescriptions with filtering and pagination
 * @access  Private (Patient: own prescriptions, Doctor: own prescriptions, Admin: clinic prescriptions)
 */
router.get("/", protect, PrescriptionController.getAll)

/**
 * @route   POST /api/prescriptions
 * @desc    Create a new prescription
 * @access  Private (Doctor only)
 */
router.post(
  "/",
  protect,
  role(["doctor"]),
  createPrescriptionValidation,
  validate,
  transactionMiddleware,
  PrescriptionController.create,
)

/**
 * @route   GET /api/prescriptions/:id/download
 * @desc    Download prescription as PDF
 * @access  Private (Patient: own prescription, Doctor: own prescription, Admin: clinic prescription)
 */
router.get(
  "/:id/download",
  protect,
  [param("id").isInt().withMessage("Prescription ID must be an integer")],
  validate,
  PrescriptionController.downloadPDF,
)

/**
 * @route   GET /api/prescriptions/:id/print
 * @desc    Get prescription in print format
 * @access  Private (Patient: own prescription, Doctor: own prescription, Admin: clinic prescription)
 */
router.get(
  "/:id/print",
  protect,
  [param("id").isInt().withMessage("Prescription ID must be an integer")],
  validate,
  PrescriptionController.printPrescription,
)

/**
 * @route   POST /api/prescriptions/:id/print
 * @desc    Handle print actions (print, email, fax)
 * @access  Private (Patient: own prescription, Doctor: own prescription, Admin: clinic prescription)
 */
router.post(
  "/:id/print",
  protect,
  [param("id").isInt().withMessage("Prescription ID must be an integer")],
  validate,
  PrescriptionController.printPrescription,
)

/**
 * @route   GET /api/prescriptions/:id
 * @desc    Get single prescription by ID
 * @access  Private (Patient: own prescription, Doctor: own prescription, Admin: clinic prescription)
 */
router.get(
  "/:id",
  protect,
  [param("id").isInt().withMessage("Prescription ID must be an integer")],
  validate,
  PrescriptionController.getById,
)

/**
 * @route   PUT /api/prescriptions/:id
 * @desc    Update a prescription
 * @access  Private (Doctor: own prescription, Admin: clinic prescription)
 */
router.put(
  "/:id",
  protect,
  role(["doctor", "clinic_admin", "platform_admin"]),
  updatePrescriptionValidation,
  validate,
  transactionMiddleware,
  PrescriptionController.update,
)

/**
 * @route   DELETE /api/prescriptions/:id
 * @desc    Cancel a prescription
 * @access  Private (Doctor: own prescription, Admin: clinic prescription)
 */
router.delete(
  "/:id",
  protect,
  role(["doctor", "clinic_admin", "platform_admin"]),
  [param("id").isInt().withMessage("Prescription ID must be an integer")],
  validate,
  transactionMiddleware,
  PrescriptionController.delete,
)

// =====================================================
// RELATED ENTITY ROUTES
// =====================================================

/**
 * @route   GET /api/prescriptions/patient/:patientId
 * @desc    Get prescriptions by patient ID
 * @access  Private (Doctor, Admin only)
 */
router.get(
  "/patient/:patientId",
  protect,
  role(["doctor", "clinic_admin", "platform_admin"]),
  [
    param("patientId").isInt().withMessage("Patient ID must be an integer"),
    query("status").optional().isIn(["active", "completed", "cancelled", "expired"]).withMessage("Invalid status"),
    query("limit").optional().isInt({ min: 1, max: 100 }).withMessage("Limit must be between 1 and 100"),
    query("offset").optional().isInt({ min: 0 }).withMessage("Offset must be non-negative"),
  ],
  validate,
  PrescriptionController.getByPatient,
)

/**
 * @route   GET /api/prescriptions/doctor/:doctorId
 * @desc    Get prescriptions by doctor ID
 * @access  Private (Admin only)
 */
router.get(
  "/doctor/:doctorId",
  protect,
  role(["clinic_admin", "platform_admin"]),
  [
    param("doctorId").isInt().withMessage("Doctor ID must be an integer"),
    query("status").optional().isIn(["active", "completed", "cancelled", "expired"]).withMessage("Invalid status"),
    query("limit").optional().isInt({ min: 1, max: 100 }).withMessage("Limit must be between 1 and 100"),
    query("offset").optional().isInt({ min: 0 }).withMessage("Offset must be non-negative"),
  ],
  validate,
  async (req, res) => {
    try {
      // Reuse the getAll method with doctor filter
      req.query.doctor_id = req.params.doctorId
      await PrescriptionController.getAll(req, res)
    } catch (error) {
      res.status(500).json({ success: false, error: "Server error" })
    }
  },
)

/**
 * @route   GET /api/prescriptions/clinic/:clinicId
 * @desc    Get prescriptions by clinic ID
 * @access  Private (Admin only)
 */
router.get(
  "/clinic/:clinicId",
  protect,
  role(["clinic_admin", "platform_admin"]),
  [
    param("clinicId").isInt().withMessage("Clinic ID must be an integer"),
    query("status").optional().isIn(["active", "completed", "cancelled", "expired"]).withMessage("Invalid status"),
    query("limit").optional().isInt({ min: 1, max: 100 }).withMessage("Limit must be between 1 and 100"),
    query("offset").optional().isInt({ min: 0 }).withMessage("Offset must be non-negative"),
  ],
  validate,
  async (req, res) => {
    try {
      // Reuse the getAll method with clinic filter
      req.query.clinic_id = req.params.clinicId
      await PrescriptionController.getAll(req, res)
    } catch (error) {
      res.status(500).json({ success: false, error: "Server error" })
    }
  },
)

/**
 * @route   GET /api/prescriptions/appointment/:appointmentId
 * @desc    Get prescriptions by appointment ID
 * @access  Private
 */
router.get(
  "/appointment/:appointmentId",
  protect,
  [param("appointmentId").isInt().withMessage("Appointment ID must be an integer")],
  validate,
  async (req, res) => {
    try {
      const { appointmentId } = req.params

      // First verify the user has access to this appointment
      let appointmentQuery, appointmentParams

      if (req.user.role === "patient") {
        appointmentQuery = "SELECT id FROM appointments WHERE id = $1 AND patient_id = $2"
        appointmentParams = [appointmentId, req.user.id]
      } else if (req.user.role === "doctor") {
        appointmentQuery = "SELECT id FROM appointments WHERE id = $1 AND doctor_id = $2"
        appointmentParams = [appointmentId, req.user.id]
      } else if (req.user.role === "clinic_admin") {
        appointmentQuery = `
          SELECT a.id FROM appointments a 
          WHERE a.id = $1 AND a.clinic_id IN (
            SELECT clinic_id FROM admin_clinics WHERE admin_id = $2
          )
        `
        appointmentParams = [appointmentId, req.user.id]
      } else if (req.user.role === "platform_admin") {
        appointmentQuery = "SELECT id FROM appointments WHERE id = $1"
        appointmentParams = [appointmentId]
      } else {
        return res.status(403).json({ success: false, error: "Unauthorized access" })
      }

      const { executeQuery } = require("../utils/dbUtils")
      const appointmentCheck = await executeQuery(appointmentQuery, appointmentParams)

      if (appointmentCheck.rows.length === 0) {
        return res.status(404).json({ success: false, error: "Appointment not found or unauthorized" })
      }

      // Get prescriptions for this appointment
      const prescriptionsQuery = `
        SELECT p.*, 
               u1.full_name AS patient_name,
               u2.full_name AS doctor_name,
               c.name AS clinic_name
        FROM prescriptions p 
        JOIN users u1 ON p.patient_id = u1.id 
        JOIN users u2 ON p.doctor_id = u2.id 
        LEFT JOIN clinics c ON p.clinic_id = c.id 
        WHERE p.appointment_id = $1
        ORDER BY p.created_at DESC
      `

      const result = await executeQuery(prescriptionsQuery, [appointmentId])

      // Parse medications JSON for each prescription safely
      const prescriptions = result.rows.map((prescription) => {
        try {
          if (typeof prescription.medication === "string") {
            prescription.medications = JSON.parse(prescription.medication)
          } else if (Array.isArray(prescription.medication)) {
            prescription.medications = prescription.medication
          } else {
            prescription.medications = []
          }
        } catch (e) {
          prescription.medications = []
        }
        return prescription
      })

      res.json({
        success: true,
        prescriptions,
      })
    } catch (error) {
      console.error("Get prescriptions by appointment error:", error)
      res.status(500).json({ success: false, error: "Server error" })
    }
  },
)

module.exports = router
