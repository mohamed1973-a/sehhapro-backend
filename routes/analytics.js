const express = require("express")
const router = express.Router()
const { pool } = require("../config/database")
const { protect, role } = require("../middleware/auth")
const logger = require("../middleware/logger")

// User statistics for platform admin
router.get("/user-stats", protect, role(["platform_admin"]), async (req, res) => {
  try {
    // Get total users count
    const totalUsersResult = await pool.query("SELECT COUNT(*) as count FROM users")

    // Get users by role - no status column, so we're removing that query
    const doctorsResult = await pool.query(
      "SELECT COUNT(*) as count FROM users u JOIN roles r ON u.role_id = r.id WHERE r.name = 'doctor'",
    )
    const nursesResult = await pool.query(
      "SELECT COUNT(*) as count FROM users u JOIN roles r ON u.role_id = r.id WHERE r.name = 'nurse'",
    )
    const patientsResult = await pool.query(
      "SELECT COUNT(*) as count FROM users u JOIN roles r ON u.role_id = r.id WHERE r.name = 'patient'",
    )
    const adminsResult = await pool.query(
      "SELECT COUNT(*) as count FROM users u JOIN roles r ON u.role_id = r.id WHERE r.name IN ('platform_admin', 'clinic_admin', 'lab_admin')",
    )
    const labTechsResult = await pool.query(
      "SELECT COUNT(*) as count FROM users u JOIN roles r ON u.role_id = r.id WHERE r.name = 'lab_tech'",
    )

    const stats = {
      total_users: Number.parseInt(totalUsersResult.rows[0].count),
      active_users: Number.parseInt(totalUsersResult.rows[0].count), // Since we don't have status, assume all users are active
      doctors: Number.parseInt(doctorsResult.rows[0].count),
      nurses: Number.parseInt(nursesResult.rows[0].count),
      patients: Number.parseInt(patientsResult.rows[0].count),
      admins: Number.parseInt(adminsResult.rows[0].count),
      lab_techs: Number.parseInt(labTechsResult.rows[0].count),
    }

    logger.info("User statistics retrieved successfully")
    res.json({ success: true, data: stats })
  } catch (error) {
    logger.error(`Error fetching user statistics: ${error.message}`)
    res.status(500).json({ success: false, message: "Error fetching user statistics" })
  }
})

// Clinic statistics for platform admin
router.get("/clinic-stats", protect, role(["platform_admin"]), async (req, res) => {
  try {
    // Get total clinics count
    const totalClinicsResult = await pool.query("SELECT COUNT(*) as count FROM clinics")

    // Get total staff across all clinics
    const totalStaffResult = await pool.query(`
      SELECT COUNT(DISTINCT user_id) as count FROM (
        SELECT doctor_id as user_id FROM doctor_clinics
        UNION
        SELECT nurse_id as user_id FROM nurse_clinics
        UNION
        SELECT admin_id as user_id FROM admin_clinics
      ) as all_staff
    `)

    // Get total patients (users who have had appointments)
    const totalPatientsResult = await pool.query("SELECT COUNT(DISTINCT patient_id) as count FROM appointments")

    // Get monthly appointments (current month)
    const monthlyAppointmentsResult = await pool.query(`
      SELECT COUNT(*) as count FROM appointments a
      JOIN availability_slots s ON a.slot_id = s.id
      WHERE EXTRACT(MONTH FROM s.start_time) = EXTRACT(MONTH FROM CURRENT_DATE)
      AND EXTRACT(YEAR FROM s.start_time) = EXTRACT(YEAR FROM CURRENT_DATE)
    `)

    // Mock revenue calculation (you would implement actual billing logic)
    const revenueThisMonth = 125000 // This would come from your billing system

    const stats = {
      total_clinics: Number.parseInt(totalClinicsResult.rows[0].count),
      active_clinics: Number.parseInt(totalClinicsResult.rows[0].count), // Assume all clinics are active
      total_staff: Number.parseInt(totalStaffResult.rows[0].count),
      total_patients: Number.parseInt(totalPatientsResult.rows[0].count),
      monthly_appointments: Number.parseInt(monthlyAppointmentsResult.rows[0].count),
      revenue_this_month: revenueThisMonth,
    }

    logger.info("Clinic statistics retrieved successfully")
    res.json({ success: true, data: stats })
  } catch (error) {
    logger.error(`Error fetching clinic statistics: ${error.message}`)
    res.status(500).json({ success: false, message: "Error fetching clinic statistics" })
  }
})

// Platform admin dashboard stats
router.get("/platform-admin-stats", protect, role(["platform_admin"]), async (req, res) => {
  try {
    // Get comprehensive platform statistics
    const totalUsersResult = await pool.query("SELECT COUNT(*) as count FROM users")
    const totalClinicsResult = await pool.query("SELECT COUNT(*) as count FROM clinics")
    const totalAppointmentsResult = await pool.query("SELECT COUNT(*) as count FROM appointments")

    // Get active users (last 30 days login - approximation)
    const activeUsersResult = await pool.query(`
      SELECT COUNT(DISTINCT user_id) as count 
      FROM refresh_tokens 
      WHERE created_at > NOW() - INTERVAL '30 days'
    `)

    // Mock system health (you would implement actual health checks)
    const systemHealth = 99.8

    const stats = {
      totalUsers: Number.parseInt(totalUsersResult.rows[0].count),
      totalClinics: Number.parseInt(totalClinicsResult.rows[0].count),
      activeUsers: Number.parseInt(activeUsersResult.rows[0].count || 0),
      totalAppointments: Number.parseInt(totalAppointmentsResult.rows[0].count),
      systemHealth: systemHealth,
    }

    logger.info("Platform admin statistics retrieved successfully")
    res.json({ success: true, data: stats })
  } catch (error) {
    logger.error(`Error fetching platform admin statistics: ${error.message}`)
    res.status(500).json({ success: false, message: `Error fetching platform admin statistics: ${error.message}` })
  }
})

module.exports = router
