/**
 * User Statistics Controller
 *
 * Handles fetching user statistics and metrics
 */
const { pool } = require("../config/database")
const logger = require("../middleware/logger")

class UserStatsController {
  /**
   * Get user statistics by ID
   */
  static async getUserStats(req, res) {
    try {
      const { id } = req.params

      // Verify user exists
      const userCheck = await pool.query("SELECT id, created_at, last_login FROM users WHERE id = $1", [id])

      if (!userCheck.rows.length) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        })
      }

      const user = userCheck.rows[0]

      // Get appointment statistics
      const appointmentStats = await pool.query(
        `
        SELECT 
          COUNT(*) as total_appointments,
          COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_appointments,
          COUNT(CASE WHEN status = 'booked' AND appointment_time > NOW() THEN 1 END) as upcoming_appointments,
          COUNT(CASE WHEN status = 'cancelled' THEN 1 END) as cancelled_appointments
        FROM appointments 
        WHERE patient_id = $1 OR doctor_id = $1
      `,
        [id],
      )

      // Get prescription statistics
      const prescriptionStats = await pool.query(
        `
        SELECT 
          COUNT(*) as total_prescriptions,
          COUNT(CASE WHEN status = 'active' THEN 1 END) as active_prescriptions
        FROM prescriptions 
        WHERE patient_id = $1 OR doctor_id = $1
      `,
        [id],
      )

      // Calculate account age in days
      const accountAge = Math.floor(
        (new Date().getTime() - new Date(user.created_at).getTime()) / (1000 * 60 * 60 * 24),
      )

      // Get login count from activity logs (if table exists)
      let loginCount = 0
      try {
        const loginStats = await pool.query(
          `
          SELECT COUNT(*) as login_count
          FROM user_activity_logs 
          WHERE user_id = $1 AND action = 'LOGIN'
        `,
          [id],
        )
        loginCount = Number(loginStats.rows[0]?.login_count || 0)
      } catch (error) {
        // Table might not exist, use default value
        logger.warn(`Activity logs table not found: ${error.message}`)
      }

      const stats = {
        totalAppointments: Number(appointmentStats.rows[0]?.total_appointments || 0),
        completedAppointments: Number(appointmentStats.rows[0]?.completed_appointments || 0),
        upcomingAppointments: Number(appointmentStats.rows[0]?.upcoming_appointments || 0),
        cancelledAppointments: Number(appointmentStats.rows[0]?.cancelled_appointments || 0),
        totalPrescriptions: Number(prescriptionStats.rows[0]?.total_prescriptions || 0),
        activePrescriptions: Number(prescriptionStats.rows[0]?.active_prescriptions || 0),
        accountAge,
        loginCount,
        lastActivity: user.last_login || user.created_at,
      }

      res.json({
        success: true,
        data: stats,
      })
    } catch (error) {
      logger.error(`Get user stats error: ${error.message}`)
      res.status(500).json({
        success: false,
        error: "Server error",
        details: error.message,
      })
    }
  }
}

module.exports = UserStatsController
