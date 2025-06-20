const { pool } = require("../config/database")
const logger = require("../middleware/logger")

class FeedbackController {
  // Submit feedback for a doctor after an appointment
  static async submitFeedback(req, res) {
    const { appointmentId } = req.params
    const { rating, comments } = req.body

    try {
      // Validate input
      if (!appointmentId || !rating) {
        return res.status(400).json({ error: "Appointment ID and rating are required" })
      }

      if (rating < 1 || rating > 5) {
        return res.status(400).json({ error: "Rating must be between 1 and 5" })
      }

      // Verify the appointment belongs to the patient
      const appointmentCheck = await pool.query(
        "SELECT doctor_id, status FROM appointments WHERE id = $1 AND patient_id = $2",
        [appointmentId, req.user.id],
      )

      if (appointmentCheck.rows.length === 0) {
        return res.status(404).json({ error: "Appointment not found or not authorized" })
      }

      // Check if appointment is completed
      if (appointmentCheck.rows[0].status !== "completed") {
        return res.status(400).json({ error: "Feedback can only be submitted for completed appointments" })
      }

      const doctorId = appointmentCheck.rows[0].doctor_id

      // Check if feedback already exists
      const feedbackCheck = await pool.query(
        "SELECT 1 FROM doctor_feedback WHERE appointment_id = $1 AND patient_id = $2",
        [appointmentId, req.user.id],
      )

      if (feedbackCheck.rows.length > 0) {
        return res.status(400).json({ error: "Feedback already submitted for this appointment" })
      }

      // Insert feedback
      const result = await pool.query(
        "INSERT INTO doctor_feedback (appointment_id, patient_id, doctor_id, rating, comments) VALUES ($1, $2, $3, $4, $5) RETURNING *",
        [appointmentId, req.user.id, doctorId, rating, comments],
      )

      // Update appointment to mark feedback as submitted
      await pool.query("UPDATE appointments SET feedback_submitted = TRUE WHERE id = $1", [appointmentId])

      logger.info(`Feedback submitted for appointment: ${appointmentId}`)
      res.status(201).json({
        message: "Feedback submitted successfully",
        feedback: result.rows[0],
      })
    } catch (err) {
      console.error("Submit feedback error:", err.message, err.stack)
      logger.error(`Submit feedback error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  // Get all feedback for a doctor
  static async getDoctorFeedback(req, res) {
    const doctorId = req.params.id || req.user.id

    try {
      // Check permissions - allow patients to view doctor feedback
      if (
        req.user.id !== Number.parseInt(doctorId) &&
        req.user.role !== "clinic_admin" &&
        req.user.role !== "patient"
      ) {
        return res.status(403).json({ error: "Not authorized to view this feedback" })
      }

      // If patient is requesting, verify they have appointments with this doctor
      if (req.user.role === "patient" && req.user.id !== Number.parseInt(doctorId)) {
        const appointmentCheck = await pool.query(
          "SELECT 1 FROM appointments WHERE patient_id = $1 AND doctor_id = $2 LIMIT 1",
          [req.user.id, doctorId],
        )

        if (appointmentCheck.rows.length === 0) {
          return res.status(403).json({ error: "Not authorized to view feedback for this doctor" })
        }
      }

      const result = await pool.query(
        `SELECT df.*, u.full_name AS patient_name 
                 FROM doctor_feedback df 
                 JOIN users u ON df.patient_id = u.id 
                 WHERE df.doctor_id = $1 
                 ORDER BY df.created_at DESC`,
        [doctorId],
      )

      // Calculate average rating
      let averageRating = 0
      if (result.rows.length > 0) {
        const sum = result.rows.reduce((total, feedback) => total + feedback.rating, 0)
        averageRating = sum / result.rows.length
      }

      logger.info(`Feedback retrieved for doctor: ${doctorId}`)
      res.status(200).json({
        averageRating,
        totalReviews: result.rows.length,
        feedback: result.rows,
      })
    } catch (err) {
      console.error("Get doctor feedback error:", err.message, err.stack)
      logger.error(`Get doctor feedback error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }
}

module.exports = FeedbackController
