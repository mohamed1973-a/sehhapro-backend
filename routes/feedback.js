const express = require("express")
const router = express.Router()
const FeedbackController = require("../controllers/feedbackController")
const { protect, role } = require("../middleware/auth")
const { body } = require("express-validator")
const { validate } = require("../middleware/validator")

// Submit feedback
router.post(
  "/appointments/:appointmentId",
  protect,
  role(["patient"]),
  [
    body("rating").isInt({ min: 1, max: 5 }).withMessage("Rating must be between 1 and 5"),
    body("comments").optional().isString(),
  ],
  validate,
  FeedbackController.submitFeedback,
)

// Get doctor feedback
router.get("/doctors/:id", protect, FeedbackController.getDoctorFeedback)

module.exports = router
