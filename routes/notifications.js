const express = require("express")
const router = express.Router()
const NotificationController = require("../controllers/notificationController")
const { protect, role } = require("../middleware/auth")
const { body } = require("express-validator")
const { validate } = require("../middleware/validator")
const logger = require("../middleware/logger")

// Create a new notification (with optional SMS via Twilio)
router.post(
  "/",
  protect,
  [
    body("userId").isInt().withMessage("User ID must be an integer"),
    body("title").optional().isString().withMessage("Title must be a string"),
    body("message").notEmpty().withMessage("Message is required"),
    body("type").notEmpty().withMessage("Type is required"),
    body("priority").optional().isIn(["low", "normal", "high", "urgent"]).withMessage("Invalid priority"),
    body("sendSms").optional().isBoolean().withMessage("sendSms must be a boolean"),
    body("refId").optional().isInt().withMessage("Reference ID must be an integer"),
    body("refTable").optional().isString().withMessage("Reference table must be a string"),
    body("actionUrl").optional().isString().withMessage("Action URL must be a string"),
    // Optional: Add carrier if you want to support fallback logic in the future
    body("carrier")
      .optional()
      .isString()
      .withMessage("Carrier must be a string"),
  ],
  validate,
  NotificationController.create,
)

// Get all notifications for the authenticated user
router.get("/", protect, NotificationController.getAll)

// Mark a notification as read
router.put("/:id/read", protect, NotificationController.markAsRead)

// Mark all notifications as read
router.put("/read-all", protect, NotificationController.markAllAsRead)

// Delete a notification
router.delete("/:id", protect, NotificationController.delete)

// Delete all notifications
router.delete("/clear", protect, NotificationController.clearAll)

// Update SMS configuration (admin only)
router.post(
  "/config",
  protect,
  role(["clinic_admin"]),
  [
    body("type").notEmpty().withMessage("Notification type required"),
    body("sms_enabled").isBoolean().withMessage("sms_enabled must be a boolean"),
    body("sms_template").optional().isString().withMessage("sms_template must be a string"),
  ],
  validate,
  NotificationController.updateConfig,
)

module.exports = router
