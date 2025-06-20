/**
 * Nurse Routes
 */
const express = require("express")
const router = express.Router()
const NurseController = require("../controllers/nurseController")
const { protect, role } = require("../middleware/auth")
const { body, query } = require("express-validator")
const { validate } = require("../middleware/validator")

// Get all nurses (admin only)
router.get(
  "/",
  protect,
  role(["platform_admin", "clinic_admin", "lab_admin"]),
  [query("search").optional().isString(), query("specialty").optional().isString()],
  validate,
  NurseController.getAllNurses,
)

// Get nurse's own portfolio
router.get("/portfolio", protect, role(["nurse"]), NurseController.getPortfolio)

// Get specific nurse's portfolio
router.get("/portfolio/:id", protect, NurseController.getPortfolio)

// Update nurse portfolio (own or admin)
router.put(
  "/:id/portfolio",
  protect,
  role(["nurse", "clinic_admin"]),
  [
    body("specialty").optional().isString(),
    body("yearsExperience").optional().isInt({ min: 0 }),
    body("education").optional(),
    body("certifications").optional(),
    body("languages").optional(),
    body("profilePicture").optional().isString(),
    body("bio").optional().isString(),
    body("licenseNumber").optional().isString(),
  ],
  validate,
  NurseController.updatePortfolio,
)

// Delete a nurse (admin only)
router.delete("/:id", protect, role(["platform_admin", "clinic_admin"]), NurseController.deleteNurse)

module.exports = router
