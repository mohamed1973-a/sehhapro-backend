/**
 * Clinic Routes
 *
 * Routes for managing clinics and their associations.
 */

const express = require("express")
const router = express.Router()
const { protect, role } = require("../middleware/auth")
const ClinicController = require("../controllers/clinicController")
const AppointmentController = require("../controllers/appointmentController")
const { body, query, validationResult } = require("express-validator")
const { pool } = require("../config/database")

// Validation middleware
const validate = (req, res, next) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }
  next()
}

// Public routes (no authentication required)
router.get("/public", ClinicController.getPublicClinics)

// Protected routes
router.use(protect) // All routes below require authentication

// Get all clinics
router.get("/", ClinicController.getAllClinics)

// Create a new clinic
router.post(
  "/",
  role(["platform_admin", "clinic_admin"]),
  [
    body("name").notEmpty().withMessage("Clinic name is required"),
    body("address").notEmpty().withMessage("Address is required"),
    body("phone").optional().isMobilePhone().withMessage("Invalid phone number"),
    body("email").optional().isEmail().withMessage("Invalid email address"),
    body("type").optional().isIn(["parent", "child", "main", "lab"]).withMessage("Invalid clinic type"),
  ],
  validate,
  ClinicController.createClinic,
)

// Get specific clinic
router.get("/:id", ClinicController.getClinic)

// Update clinic
router.put(
  "/:id",
  role(["platform_admin", "clinic_admin"]),
  [
    body("name").optional().notEmpty().withMessage("Clinic name cannot be empty"),
    body("phone").optional().isMobilePhone().withMessage("Invalid phone number"),
    body("email").optional().isEmail().withMessage("Invalid email address"),
    body("type").optional().isIn(["parent", "child", "main", "lab"]).withMessage("Invalid clinic type"),
  ],
  validate,
  ClinicController.updateClinic,
)

// Delete clinic
router.delete("/:id", role(["platform_admin", "clinic_admin"]), ClinicController.deleteClinic)

// Get clinic staff
router.get("/:id/staff", role(["platform_admin", "clinic_admin", "lab_admin"]), ClinicController.getClinicStaff)

// Remove staff member from clinic
router.delete("/:id/staff/:staffId", role(["platform_admin", "clinic_admin"]), ClinicController.removeStaffMember)

// Add clinic appointments stats route
router.get(
  "/:id/appointments/stats",
  role(["clinic_admin", "platform_admin"]),
  AppointmentController.getClinicStatsByClinicId,
)

// Staff association routes
router.post("/:clinicId/doctors", role(["platform_admin", "clinic_admin"]), ClinicController.addDoctor)
router.post("/:clinicId/nurses", role(["platform_admin", "clinic_admin"]), ClinicController.addNurse)
router.post("/:clinicId/labs", role(["platform_admin", "clinic_admin"]), ClinicController.addLab)
router.post("/:clinicId/patients", role(["platform_admin", "clinic_admin"]), ClinicController.addPatient)
router.post("/:clinicId/admins", role(["platform_admin"]), ClinicController.addAdmin)

// Get clinic staff stats
router.get("/:id/staff/stats", role(["platform_admin", "clinic_admin", "lab_admin"]), async (req, res) => {
  try {
    const { id } = req.params
    console.log(`[Clinic Routes] Getting staff stats for clinic ${id}`)

    // Check if clinic exists
    const clinicResult = await pool.query("SELECT * FROM clinics WHERE id = $1", [id])
    if (!clinicResult.rows.length) {
      console.log(`[Clinic Routes] Clinic ${id} not found`)
      return res.status(404).json({
        success: false,
        error: "Clinic not found",
        endpoint: `/api/clinics/${id}/staff/stats`,
      })
    }

    // Get staff counts by role
    const staffStats = {
      totalStaff: 0,
      doctors: 0,
      nurses: 0,
      labTechs: 0,
      admins: 0,
      breakdown: [],
    }

    // Count doctors
    try {
      const doctorCount = await pool.query("SELECT COUNT(*) as count FROM doctor_clinics WHERE clinic_id = $1", [id])
      staffStats.doctors = Number.parseInt(doctorCount.rows[0].count) || 0
    } catch (err) {
      console.log(`[Clinic Routes] Doctor table doesn't exist or error: ${err.message}`)
      staffStats.doctors = 0
    }

    // Count nurses
    try {
      const nurseCount = await pool.query("SELECT COUNT(*) as count FROM nurse_clinics WHERE clinic_id = $1", [id])
      staffStats.nurses = Number.parseInt(nurseCount.rows[0].count) || 0
    } catch (err) {
      console.log(`[Clinic Routes] Nurse table doesn't exist or error: ${err.message}`)
      staffStats.nurses = 0
    }

    // Count lab techs
    try {
      const labCount = await pool.query("SELECT COUNT(*) as count FROM lab_clinics WHERE clinic_id = $1", [id])
      staffStats.labTechs = Number.parseInt(labCount.rows[0].count) || 0
    } catch (err) {
      console.log(`[Clinic Routes] Lab table doesn't exist or error: ${err.message}`)
      staffStats.labTechs = 0
    }

    // Count admins
    try {
      const adminCount = await pool.query("SELECT COUNT(*) as count FROM admin_clinics WHERE clinic_id = $1", [id])
      staffStats.admins = Number.parseInt(adminCount.rows[0].count) || 0
    } catch (err) {
      console.log(`[Clinic Routes] Admin table doesn't exist or error: ${err.message}`)
      staffStats.admins = 0
    }

    staffStats.totalStaff = staffStats.doctors + staffStats.nurses + staffStats.labTechs + staffStats.admins

    console.log(`[Clinic Routes] Staff stats for clinic ${id}:`, staffStats)

    res.json({
      success: true,
      data: staffStats,
      message: `Staff stats retrieved for clinic ${id}`,
    })
  } catch (error) {
    console.error(`[Clinic Routes] Staff stats error for clinic ${req.params.id}:`, error)
    res.status(500).json({
      success: false,
      error: "Server error getting staff stats",
      details: error.message,
      endpoint: `/api/clinics/${req.params.id}/staff/stats`,
    })
  }
})

// Get clinic activity
router.get("/:id/activity", role(["platform_admin", "clinic_admin", "lab_admin"]), async (req, res) => {
  try {
    const { id } = req.params
    const { limit = 10 } = req.query

    // Mock activity data for now - replace with real database query
    const activities = [
      {
        id: 1,
        type: "appointment",
        title: "New appointment scheduled",
        description: "Dr. Smith scheduled with Patient John Doe",
        timestamp: new Date().toISOString(),
        user: "Dr. Smith",
        status: "scheduled",
      },
      {
        id: 2,
        type: "staff",
        title: "New staff member added",
        description: "Nurse Jane added to clinic",
        timestamp: new Date(Date.now() - 3600000).toISOString(),
        user: "Admin",
        status: "completed",
      },
    ]

    res.json({
      success: true,
      activities: activities.slice(0, Number.parseInt(limit)),
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Failed to fetch activities",
    })
  }
})

module.exports = router
