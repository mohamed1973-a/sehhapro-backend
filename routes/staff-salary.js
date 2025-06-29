const express = require('express')
const router = express.Router()
const auth = require('../middleware/auth')
const { body, validationResult } = require('express-validator')
const db = require('../config/database')
const PaymentService = require('../services/paymentService')

// Get doctor earnings
router.get('/doctor/earnings', auth, async (req, res) => {
  try {
    const doctorId = req.user.id

    // Get doctor's total earnings from completed appointments
    const [earningsResult] = await db.execute(`
      SELECT 
        COALESCE(SUM(CASE WHEN a.status = 'completed' THEN a.appointment_fee ELSE 0 END), 0) as totalEarnings,
        COALESCE(SUM(CASE WHEN a.status = 'pending' THEN a.appointment_fee ELSE 0 END), 0) as pendingPayments,
        COUNT(CASE WHEN a.status = 'completed' THEN 1 END) as completedAppointments,
        COUNT(CASE WHEN a.appointment_type = 'telemedicine' AND a.status = 'completed' THEN 1 END) as telemedicineSessions,
        COUNT(CASE WHEN a.appointment_type = 'in-person' AND a.status = 'completed' THEN 1 END) as inPersonAppointments
      FROM appointments a
      WHERE a.doctor_id = ? AND a.status IN ('completed', 'pending')
    `, [doctorId])

    // Get doctor's current balance and base salary from users table
    const [userResult] = await db.execute(`
      SELECT COALESCE(balance, 0) as currentBalance, COALESCE(base_salary, 0) as monthlySalary
      FROM users
      WHERE id = ?
    `, [doctorId])

    // Get monthly stats (optional, can be implemented as needed)
    const [monthlyStats] = await db.execute(`
      SELECT 
        TO_CHAR(a.appointment_date, 'YYYY-MM') as month,
        SUM(CASE WHEN a.status = 'completed' THEN a.appointment_fee ELSE 0 END) as earnings,
        COUNT(*) as appointments,
        SUM(CASE WHEN a.appointment_type = 'telemedicine' AND a.status = 'completed' THEN 1 ELSE 0 END) as telemedicine,
        SUM(CASE WHEN a.appointment_type = 'in-person' AND a.status = 'completed' THEN 1 ELSE 0 END) as inPerson
      FROM appointments a
      WHERE a.doctor_id = ? 
      GROUP BY month
      ORDER BY month DESC
      LIMIT 6
    `, [doctorId])

    // Get recent transactions (optional, can be implemented as needed)
    const [recentTransactions] = await db.execute(`
      SELECT 
        a.id,
        a.appointment_type as appointmentType,
        a.appointment_fee as amount,
        a.status,
        a.appointment_date as date
      FROM appointments a
      WHERE a.doctor_id = ?
      ORDER BY a.appointment_date DESC
      LIMIT 10
    `, [doctorId])

    const earnings = {
      totalEarnings: earningsResult[0].totalEarnings,
      monthlySalary: userResult[0].monthlySalary,
      currentBalance: userResult[0].currentBalance,
      pendingPayments: earningsResult[0].pendingPayments,
      completedAppointments: earningsResult[0].completedAppointments,
      telemedicineSessions: earningsResult[0].telemedicineSessions,
      inPersonAppointments: earningsResult[0].inPersonAppointments,
      monthlyStats: monthlyStats.map(stat => ({
        month: stat.month,
        earnings: stat.earnings,
        appointments: stat.appointments,
        telemedicine: stat.telemedicine,
        inPerson: stat.inPerson
      })),
      recentTransactions
    }

    res.json(earnings)
  } catch (error) {
    console.error('Error fetching doctor earnings:', error)
    res.status(500).json({ error: 'Failed to fetch earnings data' })
  }
})

// Get doctor appointment earnings
router.get('/doctor/appointments', auth, async (req, res) => {
  try {
    const doctorId = req.user.id

    const [appointments] = await db.execute(`
      SELECT 
        a.id,
        p.full_name as patientName,
        a.appointment_type as appointmentType,
        a.appointment_date as date,
        a.appointment_fee as amount,
        a.status,
        c.name as clinicName
      FROM appointments a
      JOIN patients p ON a.patient_id = p.id
      LEFT JOIN clinics c ON a.clinic_id = c.id
      WHERE a.doctor_id = ? AND a.status IN ('completed', 'pending')
      ORDER BY a.appointment_date DESC
      LIMIT 20
    `, [doctorId])

    res.json(appointments)
  } catch (error) {
    console.error('Error fetching doctor appointments:', error)
    res.status(500).json({ error: 'Failed to fetch appointment data' })
  }
})

// Get clinic revenue
router.get('/clinic/revenue', auth, async (req, res) => {
  try {
    const clinicId = req.user.clinic_id

    if (!clinicId) {
      return res.status(400).json({ error: 'Clinic admin must be associated with a clinic' })
    }

    // Get clinic's total revenue
    const [revenueResult] = await db.execute(`
      SELECT 
        COALESCE(SUM(CASE WHEN a.status = 'completed' THEN a.appointment_fee ELSE 0 END), 0) as totalRevenue,
        COALESCE(SUM(CASE WHEN a.status = 'pending' THEN a.appointment_fee ELSE 0 END), 0) as pendingPayments,
        COUNT(CASE WHEN a.status = 'completed' THEN 1 END) as completedAppointments,
        COUNT(CASE WHEN a.status = 'cancelled' THEN 1 END) as cancelledAppointments,
        COALESCE(AVG(CASE WHEN a.status = 'completed' THEN a.appointment_fee END), 0) as averageAppointmentValue
      FROM appointments a
      WHERE a.clinic_id = ? AND a.status IN ('completed', 'pending', 'cancelled')
    `, [clinicId])

    // Calculate expenses (simplified - this should come from actual expense tracking)
    const totalExpenses = revenueResult[0].totalRevenue * 0.3 // Assume 30% expenses
    const netProfit = revenueResult[0].totalRevenue - totalExpenses

    // Get revenue by type
    const [revenueByType] = await db.execute(`
      SELECT 
        COALESCE(SUM(CASE WHEN appointment_type = 'telemedicine' AND status = 'completed' THEN appointment_fee ELSE 0 END), 0) as telemedicine,
        COALESCE(SUM(CASE WHEN appointment_type = 'in-person' AND status = 'completed' THEN appointment_fee ELSE 0 END), 0) as inPerson,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN appointment_fee ELSE 0 END), 0) as consultations,
        0 as procedures
      FROM appointments
      WHERE clinic_id = ?
    `, [clinicId])

    // Get monthly stats
    const [monthlyStats] = await db.execute(`
      SELECT 
        DATE_FORMAT(appointment_date, '%M %Y') as month,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN appointment_fee ELSE 0 END), 0) as revenue,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN appointment_fee ELSE 0 END), 0) * 0.3 as expenses,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN appointment_fee ELSE 0 END), 0) * 0.7 as profit,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as appointments
      FROM appointments
      WHERE clinic_id = ? 
        AND status = 'completed'
        AND appointment_date >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
      GROUP BY DATE_FORMAT(appointment_date, '%Y-%m')
      ORDER BY appointment_date DESC
    `, [clinicId])

    // Get recent transactions
    const [recentTransactions] = await db.execute(`
      SELECT 
        a.id,
        'appointment' as type,
        a.appointment_fee as amount,
        CONCAT('Appointment: ', p.full_name, ' with Dr. ', d.full_name) as description,
        p.full_name as patientName,
        d.full_name as doctorName,
        a.appointment_date as date,
        a.status
      FROM appointments a
      JOIN patients p ON a.patient_id = p.id
      JOIN doctors d ON a.doctor_id = d.id
      WHERE a.clinic_id = ? AND a.status IN ('completed', 'pending')
      ORDER BY a.appointment_date DESC
      LIMIT 10
    `, [clinicId])

    // Get staff payroll info
    const [staffPayroll] = await db.execute(`
      SELECT 
        COUNT(*) as staffCount,
        COALESCE(AVG(salary), 0) as averageSalary
      FROM doctors
      WHERE clinic_id = ?
    `, [clinicId])

    const revenue = {
      totalRevenue: revenueResult[0].totalRevenue,
      totalExpenses,
      netProfit,
      pendingPayments: revenueResult[0].pendingPayments,
      completedAppointments: revenueResult[0].completedAppointments,
      cancelledAppointments: revenueResult[0].cancelledAppointments,
      averageAppointmentValue: revenueResult[0].averageAppointmentValue,
      monthlyStats,
      revenueByType: revenueByType[0],
      recentTransactions,
      staffPayroll: {
        totalPaid: netProfit * 0.6, // Assume 60% goes to staff
        pendingPayments: revenueResult[0].pendingPayments,
        staffCount: staffPayroll[0].staffCount,
        averageSalary: staffPayroll[0].averageSalary
      }
    }

    res.json(revenue)
  } catch (error) {
    console.error('Error fetching clinic revenue:', error)
    res.status(500).json({ error: 'Failed to fetch revenue data' })
  }
})

// Get clinic transactions
router.get('/clinic/transactions', auth, async (req, res) => {
  try {
    const clinicId = req.user.clinic_id

    if (!clinicId) {
      return res.status(400).json({ error: 'Clinic admin must be associated with a clinic' })
    }

    const [transactions] = await db.execute(`
      SELECT 
        a.id,
        p.full_name as patientName,
        d.full_name as doctorName,
        a.appointment_type as appointmentType,
        a.appointment_fee as amount,
        a.status,
        a.appointment_date as date,
        'balance' as paymentMethod
      FROM appointments a
      JOIN patients p ON a.patient_id = p.id
      JOIN doctors d ON a.doctor_id = d.id
      WHERE a.clinic_id = ? AND a.status IN ('completed', 'pending')
      ORDER BY a.appointment_date DESC
      LIMIT 20
    `, [clinicId])

    res.json(transactions)
  } catch (error) {
    console.error('Error fetching clinic transactions:', error)
    res.status(500).json({ error: 'Failed to fetch transaction data' })
  }
})

// Get nurse earnings
router.get('/nurse/earnings', auth, async (req, res) => {
  try {
    const nurseId = req.user.id

    // Get nurse's total earnings from tasks (simplified - this should come from actual task tracking)
    const [earningsResult] = await db.execute(`
      SELECT 
        COALESCE(SUM(CASE WHEN a.status = 'completed' THEN 500 ELSE 0 END), 0) as totalEarnings,
        COALESCE(SUM(CASE WHEN a.status = 'pending' THEN 500 ELSE 0 END), 0) as pendingPayments,
        COUNT(CASE WHEN a.status = 'completed' THEN 1 END) as completedTasks,
        COUNT(CASE WHEN a.status = 'completed' THEN 1 END) * 2 as patientCareHours,
        COUNT(CASE WHEN a.status = 'completed' THEN 1 END) as bedsideCareSessions
      FROM appointments a
      WHERE a.doctor_id IN (
        SELECT id FROM doctors WHERE clinic_id = (SELECT clinic_id FROM nurses WHERE id = ?)
      ) AND a.status IN ('completed', 'pending')
    `, [nurseId])

    // Get nurse's current balance
    const [balanceResult] = await db.execute(`
      SELECT COALESCE(balance, 0) as currentBalance
      FROM nurses
      WHERE id = ?
    `, [nurseId])

    // Get monthly salary
    const monthlySalary = 35000 // This should come from nurse's profile or settings

    // Get monthly stats
    const [monthlyStats] = await db.execute(`
      SELECT 
        DATE_FORMAT(a.appointment_date, '%M %Y') as month,
        COUNT(CASE WHEN a.status = 'completed' THEN 1 END) * 500 as earnings,
        COUNT(CASE WHEN a.status = 'completed' THEN 1 END) as tasks,
        COUNT(CASE WHEN a.status = 'completed' THEN 1 END) * 2 as hours,
        COUNT(CASE WHEN a.status = 'completed' THEN 1 END) as bedsideCare
      FROM appointments a
      WHERE a.doctor_id IN (
        SELECT id FROM doctors WHERE clinic_id = (SELECT clinic_id FROM nurses WHERE id = ?)
      ) 
        AND a.status = 'completed'
        AND a.appointment_date >= DATE_SUB(NOW(), INTERVAL 6 MONTH)
      GROUP BY DATE_FORMAT(a.appointment_date, '%Y-%m')
      ORDER BY a.appointment_date DESC
    `, [nurseId])

    // Get recent transactions
    const [recentTransactions] = await db.execute(`
      SELECT 
        a.id,
        'task' as type,
        500 as amount,
        CONCAT('Patient care for ', p.full_name) as description,
        'bedside_care' as taskType,
        p.full_name as patientName,
        a.appointment_date as date,
        a.status
      FROM appointments a
      JOIN patients p ON a.patient_id = p.id
      WHERE a.doctor_id IN (
        SELECT id FROM doctors WHERE clinic_id = (SELECT clinic_id FROM nurses WHERE id = ?)
      ) AND a.status IN ('completed', 'pending')
      ORDER BY a.appointment_date DESC
      LIMIT 10
    `, [nurseId])

    // Task breakdown (simplified)
    const taskBreakdown = {
      bedsideCare: earningsResult[0].totalEarnings * 0.4,
      patientMonitoring: earningsResult[0].totalEarnings * 0.25,
      medicationAdministration: earningsResult[0].totalEarnings * 0.2,
      emergencyResponse: earningsResult[0].totalEarnings * 0.1,
      documentation: earningsResult[0].totalEarnings * 0.05
    }

    const earnings = {
      totalEarnings: earningsResult[0].totalEarnings,
      monthlySalary,
      currentBalance: balanceResult[0].currentBalance,
      pendingPayments: earningsResult[0].pendingPayments,
      completedTasks: earningsResult[0].completedTasks,
      bedsideCareSessions: earningsResult[0].bedsideCareSessions,
      patientCareHours: earningsResult[0].patientCareHours,
      monthlyStats: monthlyStats.map(stat => ({
        month: stat.month,
        earnings: stat.earnings,
        tasks: stat.tasks,
        hours: stat.hours,
        bedsideCare: stat.bedsideCare
      })),
      recentTransactions,
      taskBreakdown
    }

    res.json(earnings)
  } catch (error) {
    console.error('Error fetching nurse earnings:', error)
    res.status(500).json({ error: 'Failed to fetch earnings data' })
  }
})

// Get nurse tasks
router.get('/nurse/tasks', auth, async (req, res) => {
  try {
    const nurseId = req.user.id

    const [tasks] = await db.execute(`
      SELECT 
        a.id,
        p.full_name as patientName,
        'bedside_care' as taskType,
        a.appointment_date as date,
        500 as amount,
        a.status,
        2 as duration,
        c.name as clinicName
      FROM appointments a
      JOIN patients p ON a.patient_id = p.id
      LEFT JOIN clinics c ON a.clinic_id = c.id
      WHERE a.doctor_id IN (
        SELECT id FROM doctors WHERE clinic_id = (SELECT clinic_id FROM nurses WHERE id = ?)
      ) AND a.status IN ('completed', 'pending')
      ORDER BY a.appointment_date DESC
      LIMIT 20
    `, [nurseId])

    res.json(tasks)
  } catch (error) {
    console.error('Error fetching nurse tasks:', error)
    res.status(500).json({ error: 'Failed to fetch task data' })
  }
})

// Get user salary information
router.get('/users/:userId/salary', auth.protect, async (req, res) => {
  try {
    const { userId } = req.params
    const requestingUserId = req.user.id
    const userRole = req.user.role

    console.log(`[StaffSalary] Getting salary for user ${userId}, requested by ${requestingUserId} (${userRole})`)

    // Check permissions - users can only view their own salary unless they are admins
    if (requestingUserId !== parseInt(userId) && 
        userRole !== 'platform_admin' && 
        userRole !== 'clinic_admin') {
      return res.status(403).json({
        success: false,
        error: "Access denied. You can only view your own salary information."
      })
    }

    // Get user role from the database
    const { pool } = require('../config/database')
    try {
    const roleQuery = await pool.query(
      `SELECT r.name as role_name FROM users u 
       JOIN roles r ON u.role_id = r.id 
       WHERE u.id = $1`,
      [userId]
    )

    if (roleQuery.rows.length === 0) {
        console.log(`[StaffSalary] User ${userId} not found`)
        return res.status(200).json({
          success: true,
          data: {
            monthly_salary: 0,
            balance: 0,
            last_payment: null
          },
          warning: "User not found, returning default values"
      })
    }

    const userRoleFromDb = roleQuery.rows[0].role_name
      console.log(`[StaffSalary] User ${userId} has role ${userRoleFromDb}`)

    // Get salary information based on user role
    let salaryQuery
      try {
    if (userRoleFromDb === 'doctor') {
      salaryQuery = await pool.query(
        `SELECT 
           COALESCE(balance, 0) as balance,
           COALESCE(monthly_salary, 50000) as monthly_salary,
           last_payment_date
         FROM users
         WHERE id = $1`,
        [userId]
      )
    } else if (userRoleFromDb === 'nurse') {
      salaryQuery = await pool.query(
        `SELECT 
           COALESCE(balance, 0) as balance,
           COALESCE(monthly_salary, 35000) as monthly_salary,
           last_payment_date
         FROM users
         WHERE id = $1`,
        [userId]
      )
    } else if (userRoleFromDb === 'lab_tech') {
      salaryQuery = await pool.query(
        `SELECT 
           COALESCE(balance, 0) as balance,
           COALESCE(monthly_salary, 40000) as monthly_salary,
           last_payment_date
         FROM users
         WHERE id = $1`,
        [userId]
      )
    } else {
      // For other roles, return default values
      return res.status(200).json({
        success: true,
        data: {
          monthly_salary: 0,
          balance: 0,
          last_payment: null
        }
          })
        }
      } catch (queryError) {
        console.error(`[StaffSalary] Error querying salary data: ${queryError.message}`)
        // Return default values if query fails
        return res.status(200).json({
          success: true,
          data: {
            monthly_salary: userRoleFromDb === 'doctor' ? 50000 : userRoleFromDb === 'nurse' ? 35000 : userRoleFromDb === 'lab_tech' ? 40000 : 0,
            balance: 0,
            last_payment: null
          },
          warning: "Error querying salary data, returning default values"
      })
    }

    // If no salary information found, return default values
    if (salaryQuery.rows.length === 0) {
        const defaultSalary = userRoleFromDb === 'doctor' ? 50000 : userRoleFromDb === 'nurse' ? 35000 : userRoleFromDb === 'lab_tech' ? 40000 : 0
        console.log(`[StaffSalary] No salary data found for user ${userId}, using default ${defaultSalary}`)
      return res.status(200).json({
        success: true,
        data: {
            monthly_salary: defaultSalary,
          balance: 0,
          last_payment: null
        }
      })
    }

    // Return salary information
      console.log(`[StaffSalary] Returning salary data for user ${userId}`)
      return res.status(200).json({
      success: true,
      data: {
        monthly_salary: salaryQuery.rows[0].monthly_salary,
        balance: salaryQuery.rows[0].balance,
        last_payment: salaryQuery.rows[0].last_payment_date
      }
    })
    } catch (dbError) {
      console.error(`[StaffSalary] Database error: ${dbError.message}`)
      // Return default values on database error
      return res.status(200).json({
        success: true,
        data: {
          monthly_salary: 0,
          balance: 0,
          last_payment: null
        },
        warning: "Database error, returning default values"
      })
    }
  } catch (error) {
    console.error('Error fetching user salary:', error)
    // Even on error, return something usable to prevent UI issues
    res.status(200).json({
      success: true,
      data: {
        monthly_salary: 0,
        balance: 0,
        last_payment: null
      },
      error: "Failed to fetch salary information",
      details: error.message
    })
  }
})

module.exports = router 
 
 
 