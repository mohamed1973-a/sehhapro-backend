const express = require("express")
const router = express.Router()
const DoctorController = require("../controllers/doctorController")
const { protect, role } = require("../middleware/auth")
const { body } = require("express-validator")
const { validate } = require("../middleware/validator")

// Get all doctors (public)
router.get("/", DoctorController.getAll)

// Get doctors by clinic
router.get("/clinic", protect, DoctorController.getByClinic)

// Get doctor by ID
router.get("/:id", DoctorController.getById)

// Get doctor's patients
router.get("/:id/patients", protect, role(["doctor", "clinic_admin"]), DoctorController.getPatients)

// Update doctor profile
router.put(
  "/:id",
  protect,
  role(["doctor", "clinic_admin", "platform_admin"]),
  [
    body("full_name").optional().isLength({ min: 2 }).withMessage("Full name must be at least 2 characters"),
    body("email").optional().isEmail().withMessage("Valid email is required"),
    body("phone").optional().isMobilePhone().withMessage("Valid phone number is required"),
  ],
  validate,
  DoctorController.update,
)

// Get doctor portfolio
router.get("/:id/portfolio", DoctorController.getPortfolio)

// Update doctor portfolio
router.put("/:id/portfolio", protect, role(["doctor"]), DoctorController.updatePortfolio)

module.exports = router
