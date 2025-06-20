/**
 * Clinic Routes
 *
 * Routes for managing clinics and their associations.
 */

const express = require("express")
const router = express.Router()
const ClinicController = require("../controllers/clinicController")
const { protect, authorize } = require("../middleware/auth")
const { body } = require("express-validator")
const { validate } = require("../middleware/validator")

// Public routes (no authentication required)
router.get("/public", ClinicController.getPublicClinics)

// Protected routes
router.use(protect) // All routes below require authentication

// General clinic routes
router.get("/", ClinicController.getAllClinics)
router.post(
  "/",
  authorize(["platform_admin", "clinic_admin"]),
  [
    body("name").notEmpty().withMessage("Clinic name is required"),
    body("type")
      .optional()
      .isIn(["parent", "child", "main", "lab"])
      .withMessage("Invalid clinic type; must be 'parent', 'child', 'main', or 'lab'"),
  ],
  validate,
  ClinicController.createClinic,
)

// Specific clinic routes
router.get("/:id", ClinicController.getClinic)
router.put(
  "/:id",
  authorize(["platform_admin", "clinic_admin"]),
  [body("type").optional().isIn(["parent", "child", "main", "lab"]).withMessage("Invalid clinic type")],
  validate,
  ClinicController.updateClinic,
)
router.delete("/:id", authorize(["platform_admin", "clinic_admin"]), ClinicController.deleteClinic)

// Staff management routes
router.get("/:id/staff", ClinicController.getClinicStaff)
router.delete(
  "/:clinicId/staff/:staffId",
  authorize(["platform_admin", "clinic_admin"]),
  ClinicController.removeStaffMember,
)

// Association routes
router.post(
  "/:clinicId/doctors",
  authorize(["platform_admin", "clinic_admin"]),
  [body("doctorId").isInt().withMessage("Doctor ID must be an integer")],
  validate,
  ClinicController.addDoctor,
)
router.post(
  "/:clinicId/nurses",
  authorize(["platform_admin", "clinic_admin"]),
  [body("nurseId").isInt().withMessage("Nurse ID must be an integer")],
  validate,
  ClinicController.addNurse,
)
router.post(
  "/:clinicId/labs",
  authorize(["platform_admin", "clinic_admin"]),
  [body("labId").isInt().withMessage("Lab ID must be an integer")],
  validate,
  ClinicController.addLab,
)
router.post(
  "/:clinicId/patients",
  authorize(["platform_admin", "clinic_admin"]),
  [
    body("patientId").isInt().withMessage("Patient ID must be an integer"),
    body("isPrimary").optional().isBoolean().withMessage("isPrimary must be a boolean"),
  ],
  validate,
  ClinicController.addPatient,
)
router.post(
  "/:clinicId/admins",
  authorize(["platform_admin"]),
  [
    body("adminId").isInt().withMessage("Admin ID must be an integer"),
    body("isPrimary").optional().isBoolean().withMessage("isPrimary must be a boolean"),
    body("role").isIn(["clinic_admin", "lab_admin"]).withMessage("Role must be 'clinic_admin' or 'lab_admin'"),
  ],
  validate,
  ClinicController.addAdmin,
)

module.exports = router
