const express = require("express")
const router = express.Router()
const { protect } = require("../middleware/auth")
const DiseaseController = require("../controllers/diseaseController")

// Get all diseases or search
router.get("/", protect, DiseaseController.getAll)

// Get disease by ID
router.get("/:id", protect, DiseaseController.getById)

// Get medications for a disease
router.get("/:id/medications", protect, DiseaseController.getMedications)

module.exports = router
