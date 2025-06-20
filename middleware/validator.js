const { validationResult, body, param, query } = require("express-validator")

const validate = (req, res, next) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }
  next()
}

// Appointment validation rules
const appointmentValidation = [
  body("doctorId").isInt({ min: 1 }).withMessage("Doctor ID must be a positive integer"),

  body("clinicId").custom((value, { req }) => {
    // For in-person appointments, clinic is required
    if (req.body.type === "in-person") {
      if (!value) {
        throw new Error("Clinic ID is required for in-person appointments")
      }
      if (!Number.isInteger(Number(value)) || Number(value) < 1) {
        throw new Error("Clinic ID must be a positive integer")
      }
    }
    // For telemedicine, clinic should be null or undefined
    if (req.body.type === "telemedicine") {
      if (value !== null && value !== undefined) {
        throw new Error("Clinic ID should not be provided for telemedicine appointments")
      }
    }
    return true
  }),

  body("patientId")
    .optional({ nullable: true })
    .custom((value, { req }) => {
      // If provided, must be a positive integer
      if (value !== null && value !== undefined) {
        if (!Number.isInteger(Number(value)) || Number(value) < 1) {
          throw new Error("Patient ID must be a positive integer")
        }
      }
      return true
    }),

  body("date")
    .isISO8601()
    .withMessage("Date must be a valid ISO 8601 date")
    .custom((value) => {
      const appointmentDate = new Date(value)
      const now = new Date()
      if (appointmentDate < now) {
        throw new Error("Appointment date cannot be in the past")
      }
      return true
    }),

  body("type").isIn(["in-person", "telemedicine"]).withMessage("Type must be either 'in-person' or 'telemedicine'"),

  body("reason").optional().isLength({ min: 5, max: 500 }).withMessage("Reason must be between 5 and 500 characters"),

  body("specialty")
    .optional()
    .isLength({ min: 1, max: 100 })
    .withMessage("Specialty must be between 1 and 100 characters"),

  body("duration").optional().isInt({ min: 15, max: 180 }).withMessage("Duration must be between 15 and 180 minutes"),

  body("notes").optional().isLength({ max: 1000 }).withMessage("Notes must not exceed 1000 characters"),
]

// User validation rules
const userValidation = [
  body("email").isEmail().withMessage("Must be a valid email address"),

  body("password").isLength({ min: 8 }).withMessage("Password must be at least 8 characters long"),

  body("full_name").isLength({ min: 2, max: 100 }).withMessage("Full name must be between 2 and 100 characters"),

  body("role")
    .isIn(["patient", "doctor", "nurse", "clinic_admin", "lab_admin", "lab_tech", "platform_admin"])
    .withMessage("Invalid role"),
]

// Login validation rules
const loginValidation = [
  body("email").isEmail().withMessage("Must be a valid email address"),

  body("password").notEmpty().withMessage("Password is required"),
]

// ID parameter validation
const idValidation = [param("id").isInt({ min: 1 }).withMessage("ID must be a positive integer")]

// Query parameter validations
const paginationValidation = [
  query("page").optional().isInt({ min: 1 }).withMessage("Page must be a positive integer"),

  query("limit").optional().isInt({ min: 1, max: 100 }).withMessage("Limit must be between 1 and 100"),
]

module.exports = {
  validate,
  appointmentValidation,
  userValidation,
  loginValidation,
  idValidation,
  paginationValidation,
}
