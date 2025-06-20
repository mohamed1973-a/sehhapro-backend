const express = require("express")
const router = express.Router()
const RecordController = require("../controllers/recordController")
const { protect, role } = require("../middleware/auth")
const { body, param } = require("express-validator")
const { validate } = require("../middleware/validator")

router.post(
  "/",
  protect,
  role(["doctor"]),
  [
    body("patientId").isInt().withMessage("Patient ID must be an integer"),
    body("diagnosis").optional().isString().withMessage("Diagnosis must be a string"),
    body("treatment").optional().isString().withMessage("Treatment must be a string"),
    body("notes").optional().isString().withMessage("Notes must be a string"),
    body("appointmentId").optional().isInt().withMessage("Appointment ID must be an integer"),
  ],
  validate,
  RecordController.create,
)

router.get("/", protect, RecordController.getAll)

router.get(
  "/patient/:patientId",
  protect,
  [param("patientId").isInt().withMessage("Patient ID must be an integer")],
  validate,
  RecordController.getPatientRecords,
)

router.put(
  "/:id",
  protect,
  role(["doctor", "clinic_admin"]),
  [
    param("id").isInt().withMessage("Record ID must be an integer"),
    body("diagnosis").optional().isString().withMessage("Diagnosis must be a string"),
    body("treatment").optional().isString().withMessage("Treatment must be a string"),
    body("notes").optional().isString().withMessage("Notes must be a string"),
  ],
  validate,
  RecordController.update,
)

router.delete(
  "/:id",
  protect,
  role(["doctor", "clinic_admin"]),
  [param("id").isInt().withMessage("Record ID must be an integer")],
  validate,
  RecordController.delete,
)

module.exports = router
