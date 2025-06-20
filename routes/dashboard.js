const express = require("express")
const router = express.Router()
const { pool } = require("../config/database")
const { protect, role } = require("../middleware/auth")
const logger = require("../middleware/logger")
const { dashboardLimiter } = require("../middleware/rateLimit")
const { executeQuery } = require("../utils/dbUtils")

// Apply dashboard rate limiting to all routes
router.use(dashboardLimiter)

// Platform admin dashboard stats
router.get("/platform-admin/stats", protect, role(["platform_admin"]), async (req, res) => {
  try {
    // Get comprehensive platform statistics
    const totalUsersResult = await pool.query("SELECT COUNT(*) as count FROM users")
    const totalClinicsResult = await pool.query("SELECT COUNT(*) as count FROM clinics")
    const totalAppointmentsResult = await pool.query("SELECT COUNT(*) as count FROM appointments")

    // Get active users (users with recent activity)
    const activeUsersResult = await pool.query(`
      SELECT COUNT(DISTINCT user_id) as count 
      FROM refresh_tokens 
      WHERE created_at > NOW() - INTERVAL '30 days'
    `)

    // Calculate system health based on various factors
    const systemHealth = 99.8 // This would be calculated based on actual system metrics

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
    res.status(500).json({
      success: false,
      message: "Error fetching platform admin statistics",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    })
  }
})

// Doctor dashboard stats
router.get("/doctor/stats", protect, role(["doctor"]), async (req, res) => {
  try {
    // Implementation for doctor stats
    const doctorId = req.user.id

    // Get today's appointments
    const todayAppointmentsResult = await pool.query(
      `SELECT COUNT(*) as count FROM appointments a
       JOIN availability_slots s ON a.slot_id = s.id
       WHERE a.doctor_id = $1 AND DATE(s.start_time) = CURRENT_DATE`,
      [doctorId],
    )

    // Get total patients
    const totalPatientsResult = await pool.query(
      `SELECT COUNT(DISTINCT a.patient_id) as count FROM appointments a
       WHERE a.doctor_id = $1`,
      [doctorId],
    )

    // Get pending lab requests
    const pendingLabsResult = await pool.query(
      `SELECT COUNT(*) as count FROM lab_requests lr
       WHERE lr.doctor_id = $1 AND lr.status = 'pending'`,
      [doctorId],
    )

    // Get completed appointments today
    const completedTodayResult = await pool.query(
      `SELECT COUNT(*) as count FROM appointments a
       JOIN availability_slots s ON a.slot_id = s.id
       WHERE a.doctor_id = $1 AND a.status = 'completed' AND DATE(s.start_time) = CURRENT_DATE`,
      [doctorId],
    )

    // Get upcoming appointments (next 7 days)
    const upcomingAppointmentsResult = await pool.query(
      `SELECT COUNT(*) as count FROM appointments a
       JOIN availability_slots s ON a.slot_id = s.id
       WHERE a.doctor_id = $1 AND a.status IN ('booked', 'in-progress') 
       AND s.start_time BETWEEN NOW() AND NOW() + INTERVAL '7 days'`,
      [doctorId],
    )

    // Get total appointments
    const totalAppointmentsResult = await pool.query(
      `SELECT COUNT(*) as count FROM appointments a
       WHERE a.doctor_id = $1`,
      [doctorId],
    )

    // Get recent prescriptions (last 30 days)
    const recentPrescriptionsResult = await pool.query(
      `SELECT COUNT(*) as count FROM prescriptions p
       WHERE p.doctor_id = $1 AND p.created_at >= NOW() - INTERVAL '30 days'`,
      [doctorId],
    )

    // Get pending requests (appointments + lab requests)
    const pendingRequestsResult = await pool.query(
      `SELECT 
        (SELECT COUNT(*) FROM appointments WHERE doctor_id = $1 AND status = 'pending') +
        (SELECT COUNT(*) FROM lab_requests WHERE doctor_id = $1 AND status = 'pending') as count`,
      [doctorId],
    )

    const dashboardData = {
      todayAppointments: Number.parseInt(todayAppointmentsResult.rows[0].count),
      totalPatients: Number.parseInt(totalPatientsResult.rows[0].count),
      pendingLabs: Number.parseInt(pendingLabsResult.rows[0].count),
      completedToday: Number.parseInt(completedTodayResult.rows[0].count),
      upcomingAppointments: Number.parseInt(upcomingAppointmentsResult.rows[0].count),
      totalAppointments: Number.parseInt(totalAppointmentsResult.rows[0].count),
      recentPrescriptions: Number.parseInt(recentPrescriptionsResult.rows[0].count),
      pendingRequests: Number.parseInt(pendingRequestsResult.rows[0].count),
    }

    logger.info(`Doctor dashboard stats retrieved for doctor: ${doctorId}`)
    res.json({ success: true, data: dashboardData })
  } catch (error) {
    logger.error(`Error fetching doctor statistics: ${error.message}`)
    res.status(500).json({ success: false, message: "Error fetching doctor statistics" })
  }
})

// Clinic admin dashboard stats
router.get("/clinic-admin/stats", protect, role(["clinic_admin"]), async (req, res) => {
  try {
    // Implementation for clinic admin stats
    const adminId = req.user.id

    // Get clinics managed by this admin
    const clinicsResult = await pool.query(
      `SELECT c.id FROM clinics c
       JOIN clinic_admins ca ON c.id = ca.clinic_id
       WHERE ca.admin_id = $1`,
      [adminId],
    )

    const clinicIds = clinicsResult.rows.map((row) => row.id)

    if (clinicIds.length === 0) {
      return res.json({
        success: true,
        data: {
          totalAppointments: 0,
          todayAppointments: 0,
          totalDoctors: 0,
          totalPatients: 0,
          pendingAppointments: 0,
        },
      })
    }

    const clinicIdsStr = clinicIds.map((_, i) => `$${i + 2}`).join(",")

    // Get total appointments for managed clinics
    const totalAppointmentsResult = await pool.query(
      `SELECT COUNT(*) as count FROM appointments a
       WHERE a.clinic_id IN (${clinicIdsStr})`,
      [adminId, ...clinicIds],
    )

    // Get today's appointments
    const todayAppointmentsResult = await pool.query(
      `SELECT COUNT(*) as count FROM appointments a
       JOIN availability_slots s ON a.slot_id = s.id
       WHERE a.clinic_id IN (${clinicIdsStr}) AND DATE(s.start_time) = CURRENT_DATE`,
      [adminId, ...clinicIds],
    )

    // Get total doctors in managed clinics
    const totalDoctorsResult = await pool.query(
      `SELECT COUNT(DISTINCT dc.doctor_id) as count FROM doctor_clinics dc
       WHERE dc.clinic_id IN (${clinicIdsStr})`,
      [adminId, ...clinicIds],
    )

    // Get total patients in managed clinics
    const totalPatientsResult = await pool.query(
      `SELECT COUNT(DISTINCT a.patient_id) as count FROM appointments a
       WHERE a.clinic_id IN (${clinicIdsStr})`,
      [adminId, ...clinicIds],
    )

    // Get pending appointments
    const pendingAppointmentsResult = await pool.query(
      `SELECT COUNT(*) as count FROM appointments a
       WHERE a.clinic_id IN (${clinicIdsStr}) AND a.status = 'pending'`,
      [adminId, ...clinicIds],
    )

    const dashboardData = {
      totalAppointments: Number.parseInt(totalAppointmentsResult.rows[0].count),
      todayAppointments: Number.parseInt(todayAppointmentsResult.rows[0].count),
      totalDoctors: Number.parseInt(totalDoctorsResult.rows[0].count),
      totalPatients: Number.parseInt(totalPatientsResult.rows[0].count),
      pendingAppointments: Number.parseInt(pendingAppointmentsResult.rows[0].count),
    }

    logger.info(`Clinic admin dashboard stats retrieved for admin: ${adminId}`)
    res.json({ success: true, data: dashboardData })
  } catch (error) {
    logger.error(`Error fetching clinic admin statistics: ${error.message}`)
    res.status(500).json({ success: false, message: "Error fetching clinic admin statistics" })
  }
})

// Nurse dashboard stats
router.get("/nurse/stats", protect, role(["nurse"]), async (req, res) => {
  try {
    // Implementation for nurse stats
    const nurseId = req.user.id

    // Get today's appointments for nurse's clinics
    const todayAppointmentsResult = await pool.query(
      `SELECT COUNT(*) as count FROM appointments a
       JOIN nurse_clinics nc ON a.clinic_id = nc.clinic_id
       JOIN availability_slots s ON a.slot_id = s.id
       WHERE nc.nurse_id = $1 AND DATE(s.start_time) = CURRENT_DATE`,
      [nurseId],
    )

    // Get total patients for nurse's clinics
    const totalPatientsResult = await pool.query(
      `SELECT COUNT(DISTINCT a.patient_id) as count FROM appointments a
       JOIN nurse_clinics nc ON a.clinic_id = nc.clinic_id
       WHERE nc.nurse_id = $1`,
      [nurseId],
    )

    // Get pending tasks (appointments that need attention)
    const pendingTasksResult = await pool.query(
      `SELECT COUNT(*) as count FROM appointments a
       JOIN nurse_clinics nc ON a.clinic_id = nc.clinic_id
       WHERE nc.nurse_id = $1 AND a.status IN ('booked', 'in-progress')`,
      [nurseId],
    )

    const dashboardData = {
      todayAppointments: Number.parseInt(todayAppointmentsResult.rows[0].count),
      totalPatients: Number.parseInt(totalPatientsResult.rows[0].count),
      pendingTasks: Number.parseInt(pendingTasksResult.rows[0].count),
    }

    logger.info(`Nurse dashboard stats retrieved for nurse: ${nurseId}`)
    res.json({ success: true, data: dashboardData })
  } catch (error) {
    logger.error(`Error fetching nurse statistics: ${error.message}`)
    res.status(500).json({ success: false, message: "Error fetching nurse statistics" })
  }
})

// Lab admin dashboard stats
router.get("/lab-admin/stats", protect, role(["lab_admin"]), async (req, res) => {
  try {
    // Implementation for lab admin stats
    // ...
    res.json({ success: true, data: {} })
  } catch (error) {
    logger.error(`Error fetching lab admin statistics: ${error.message}`)
    res.status(500).json({ success: false, message: "Error fetching lab admin statistics" })
  }
})

// Lab tech dashboard stats
router.get("/lab-tech/stats", protect, role(["lab_tech"]), async (req, res) => {
  try {
    // Implementation for lab tech stats
    // ...
    res.json({ success: true, data: {} })
  } catch (error) {
    logger.error(`Error fetching lab tech statistics: ${error.message}`)
    res.status(500).json({ success: false, message: "Error fetching lab tech statistics" })
  }
})

// Patient dashboard stats
router.get("/patient/stats", protect, role(["patient"]), async (req, res) => {
  try {
    // Implementation for patient stats
    const patientId = req.user.id

    // Get upcoming appointments
    const upcomingAppointmentsResult = await pool.query(
      `SELECT COUNT(*) as count FROM appointments a
       JOIN availability_slots s ON a.slot_id = s.id
       WHERE a.patient_id = $1 AND a.status = 'booked' AND s.start_time > NOW()`,
      [patientId],
    )

    // Get total appointments
    const totalAppointmentsResult = await pool.query(
      `SELECT COUNT(*) as count FROM appointments a
       WHERE a.patient_id = $1`,
      [patientId],
    )

    // Get pending lab results
    const pendingLabResultsResult = await pool.query(
      `SELECT COUNT(*) as count FROM lab_requests lr
       WHERE lr.patient_id = $1 AND lr.status IN ('pending', 'in-progress')`,
      [patientId],
    )

    // Get active prescriptions
    const activePrescriptionsResult = await pool.query(
      `SELECT COUNT(*) as count FROM prescriptions p
       WHERE p.patient_id = $1 AND p.status = 'active'`,
      [patientId],
    )

    const dashboardData = {
      upcomingAppointments: Number.parseInt(upcomingAppointmentsResult.rows[0].count),
      totalAppointments: Number.parseInt(totalAppointmentsResult.rows[0].count),
      pendingLabResults: Number.parseInt(pendingLabResultsResult.rows[0].count),
      activePrescriptions: Number.parseInt(activePrescriptionsResult.rows[0].count),
    }

    logger.info(`Patient dashboard stats retrieved for patient: ${patientId}`)
    res.json({ success: true, data: dashboardData })
  } catch (error) {
    logger.error(`Error fetching patient statistics: ${error.message}`)
    res.status(500).json({ success: false, message: "Error fetching patient statistics" })
  }
})

module.exports = router
