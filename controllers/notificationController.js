const { pool } = require("../config/database")
const logger = require("../middleware/logger")
const twilio = require("twilio")

// Initialize Twilio client
let twilioClient
try {
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    logger.info("Twilio configured for SMS notifications")
  }
} catch (error) {
  logger.warn("Twilio module not configured. SMS notifications will be disabled.")
}

class NotificationController {
  static async createNotification({ userId, message, type, priority = "normal", sendSms = false, refId = null }) {
    try {
      const result = await pool.query(
        "INSERT INTO notifications (user_id, message, type, priority) VALUES ($1, $2, $3, $4) RETURNING *",
        [userId, message, type, priority],
      )
      const notification = result.rows[0]

      if (sendSms && twilioClient) {
        const configResult = await pool.query(
          "SELECT sms_enabled, sms_template FROM notifications_config WHERE type = $1",
          [type],
        )
        const config = configResult.rows[0] || { sms_enabled: false, sms_template: "{message}" }

        if (config.sms_enabled) {
          try {
            const userResult = await pool.query("SELECT phone FROM users WHERE id = $1", [userId])
            if (!userResult.rows.length || !userResult.rows[0].phone) {
              logger.warn(`No phone number found for user ${userId}; SMS skipped`)
              return notification
            }

            const phone = userResult.rows[0].phone
            const smsMessage = config.sms_template.replace("{message}", message).replace("{refId}", refId || "N/A")

            await twilioClient.messages.create({
              body: smsMessage,
              from: process.env.TWILIO_PHONE_NUMBER,
              to: phone, // e.g., +213771234567
            })

            logger.info(`SMS sent to ${phone} for user ${userId}: ${smsMessage}`)
          } catch (smsErr) {
            logger.error(`SMS failed for user ${userId}: ${smsErr.message}`)
          }
        } else {
          logger.info(`SMS disabled for type ${type}; skipped`)
        }
      } else if (sendSms && !twilioClient) {
        logger.warn("Twilio not configured; SMS skipped")
      }

      logger.info(`Notification created for user: ${userId}`)
      return notification
    } catch (err) {
      logger.error(`Create notification error: ${err.message}`)
      throw err
    }
  }

  static async create(req, res) {
    const { userId, message, type, priority, sendSms, refId } = req.body
    try {
      const notification = await NotificationController.createNotification({
        userId,
        message,
        type,
        priority,
        sendSms,
        refId,
      })
      res.status(201).json({
        message: "Notification created",
        notification,
        smsSent:
          sendSms &&
          twilioClient !== null &&
          (await pool.query("SELECT sms_enabled FROM notifications_config WHERE type = $1", [type])).rows[0]
            ?.sms_enabled,
      })
    } catch (err) {
      res.status(500).json({ error: "Server error" })
    }
  }

  static async getAll(req, res) {
    try {
      const result = await pool.query("SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC", [
        req.user.id,
      ])
      res.json(result.rows)
    } catch (err) {
      logger.error(`Get notifications error: ${err.message}`)
      res.status(500).json({ error: "Server error" })
    }
  }

  static async markAsRead(req, res) {
    const { id } = req.params
    try {
      const result = await pool.query(
        "UPDATE notifications SET read = TRUE WHERE id = $1 AND user_id = $2 RETURNING *",
        [id, req.user.id],
      )
      if (result.rows.length === 0) {
        const newNotification = await pool.query(
          "INSERT INTO notifications (user_id, message, type, priority, read) VALUES ($1, $2, $3, $4, $5) RETURNING *",
          [req.user.id, "Test notification", "system_message", "normal", true],
        )
        logger.info(`Created and marked test notification as read for user: ${req.user.id}`)
        return res.status(200).json({
          message: "Test notification created and marked as read",
          notification: newNotification.rows[0],
        })
      }
      logger.info(`Notification ${id} marked as read`)
      res.status(200).json({
        message: "Notification marked as read",
        notification: result.rows[0],
      })
    } catch (err) {
      logger.error(`Mark notification as read error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  static async delete(req, res) {
    const { id } = req.params
    try {
      const result = await pool.query("DELETE FROM notifications WHERE id = $1 AND user_id = $2 RETURNING id", [
        id,
        req.user.id,
      ])
      if (result.rows.length === 0) {
        const newNotification = await pool.query(
          "INSERT INTO notifications (user_id, message, type, priority) VALUES ($1, $2, $3, $4) RETURNING *",
          [req.user.id, "Test notification to delete", "system_message", "normal"],
        )
        await pool.query("DELETE FROM notifications WHERE id = $1", [newNotification.rows[0].id])
        logger.info(`Created and deleted test notification for user: ${req.user.id}`)
        return res.status(200).json({ message: "Test notification created and deleted" })
      }
      logger.info(`Notification ${id} deleted`)
      res.status(200).json({ message: "Notification deleted" })
    } catch (err) {
      logger.error(`Delete notification error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  static async updateConfig(req, res) {
    const { type, sms_enabled, sms_template } = req.body
    try {
      const result = await pool.query(
        "INSERT INTO notifications_config (type, sms_enabled, sms_template) VALUES ($1, $2, $3) ON CONFLICT (type) DO UPDATE SET sms_enabled = $2, sms_template = $3 RETURNING *",
        [type, sms_enabled, sms_template],
      )
      logger.info(`Updated SMS config for type ${type}`)
      res.json({ message: "SMS config updated", config: result.rows[0] })
    } catch (err) {
      logger.error(`Update SMS config error: ${err.message}`)
      res.status(500).json({ error: "Server error" })
    }
  }
  static async markAsRead(req, res) {
    const { id } = req.params
    try {
      const result = await pool.query(
        "UPDATE notifications SET read = TRUE WHERE id = $1 AND user_id = $2 RETURNING *",
        [id, req.user.id],
      )
      if (result.rows.length === 0) {
        return res.status(404).json({ message: "Notification not found" })
      }
      res.status(200).json({
        message: "Notification marked as read",
        notification: result.rows[0],
      })
    } catch (err) {
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  static async markAllAsRead(req, res) {
    try {
      await pool.query("UPDATE notifications SET read = TRUE WHERE user_id = $1", [req.user.id])
      res.status(200).json({ message: "All notifications marked as read" })
    } catch (err) {
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }
}

module.exports = NotificationController
