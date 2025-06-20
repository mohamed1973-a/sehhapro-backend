const express = require("express")
const router = express.Router()
const PatientMedicalProfileController = require("../controllers/patientMedicalProfileController")
const { protect, role } = require("../middleware/auth")
const { body, param } = require("express-validator")
const { validate } = require("../middleware/validator")

// Get patient's medical profile
router.get(
  "/:id?",
  protect,
  [param("id").optional().isInt().withMessage("Patient ID must be an integer")],
  validate,
  PatientMedicalProfileController.getProfile,
)

// Update patient's medical profile
router.put(
  "/:id?",
  protect,
  [
    param("id").optional().isInt().withMessage("Patient ID must be an integer"),
    body("medicalHistory").optional().isString().withMessage("Medical history must be a string"),
    body("familyHistory").optional().isString().withMessage("Family history must be a string"),
    body("allergies").optional().isArray().withMessage("Allergies must be an array"),
    body("medications").optional().isArray().withMessage("Medications must be an array"),
    body("immunizations").optional().isArray().withMessage("Immunizations must be an array"),
    body("surgicalHistory").optional().isString().withMessage("Surgical history must be a string"),
    body("lifestyleFactors").optional().isObject().withMessage("Lifestyle factors must be an object"),
    body("vitals").optional().isObject().withMessage("Vitals must be an object"),
    body("lastPhysicalExam").optional().isISO8601().withMessage("Last physical exam must be a valid date"),
    body("emergencyContact").optional().isObject().withMessage("Emergency contact must be an object"),
    body("basicInfo").optional().isObject().withMessage("Basic info must be an object"),
  ],
  validate,
  PatientMedicalProfileController.updateProfile,
)

// Create new medical profile (same as update for upsert functionality)
router.post(
  "/:id?",
  protect,
  [
    param("id").optional().isInt().withMessage("Patient ID must be an integer"),
    body("medicalHistory").optional().isString().withMessage("Medical history must be a string"),
    body("familyHistory").optional().isString().withMessage("Family history must be a string"),
    body("allergies").optional().isArray().withMessage("Allergies must be an array"),
    body("medications").optional().isArray().withMessage("Medications must be an array"),
    body("immunizations").optional().isArray().withMessage("Immunizations must be an array"),
    body("surgicalHistory").optional().isString().withMessage("Surgical history must be a string"),
    body("lifestyleFactors").optional().isObject().withMessage("Lifestyle factors must be an object"),
    body("vitals").optional().isObject().withMessage("Vitals must be an object"),
    body("lastPhysicalExam").optional().isISO8601().withMessage("Last physical exam must be a valid date"),
    body("emergencyContact").optional().isObject().withMessage("Emergency contact must be an object"),
    body("basicInfo").optional().isObject().withMessage("Basic info must be an object"),
  ],
  validate,
  PatientMedicalProfileController.updateProfile,
)

// Delete medical profile (soft delete by clearing data)
router.delete(
  "/:id?",
  protect,
  role(["patient", "doctor", "clinic_admin"]),
  [param("id").optional().isInt().withMessage("Patient ID must be an integer")],
  validate,
  async (req, res) => {
    try {
      const patientId = req.params.id || req.user.id

      // Check authorization
      if (
        req.user.id !== Number.parseInt(patientId) &&
        req.user.role !== "doctor" &&
        req.user.role !== "clinic_admin"
      ) {
        return res.status(403).json({ error: "Not authorized to delete this profile" })
      }

      const { pool } = require("../config/database")
      const logger = require("../middleware/logger")

      // Soft delete by clearing all profile data
      await pool.query(
        `UPDATE patient_medical_profiles 
         SET medical_history = NULL,
             family_history = NULL,
             allergies = NULL,
             medications = NULL,
             immunizations = NULL,
             surgical_history = NULL,
             lifestyle_factors = NULL,
             vitals = NULL,
             last_physical_exam = NULL,
             updated_at = NOW()
         WHERE patient_id = $1`,
        [patientId],
      )

      logger.info(`Medical profile cleared for patient: ${patientId}`)
      res.status(200).json({ message: "Medical profile cleared successfully" })
    } catch (err) {
      const logger = require("../middleware/logger")
      logger.error(`Delete medical profile error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  },
)

module.exports = router
