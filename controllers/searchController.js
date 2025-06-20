/**
 * Search Controller
 *
 * Handles all search functionality in the application.
 */
const { pool } = require("../config/database")
const logger = require("../middleware/logger")

class SearchController {
  /**
   * Search for patients based on query parameters
   */
  static async searchPatients(req, res) {
    // Get search parameters
    const query = req.query.query
    const exact = req.query.exact === "true"
    const phone = req.query.phone

    try {
      // Handle empty search
      if (!query && !phone) {
        // Return limited list of patients
        const allPatients = await pool.query(
          "SELECT id, full_name, email, phone FROM users WHERE role_id = (SELECT id FROM roles WHERE name = 'patient') LIMIT 10",
        )
        return res.status(200).json(allPatients.rows)
      }

      // Initialize query variables
      let sqlQuery = ""
      const params = []
      const conditions = []

      // Set base query based on user role
      if (req.user.role === "patient") {
        // Patients can only see themselves
        sqlQuery = `
          SELECT id, full_name, email, phone 
          FROM users 
          WHERE id = $1 AND role_id = (SELECT id FROM roles WHERE name = 'patient')
        `
        params.push(req.user.id)
      } else if (req.user.role === "doctor") {
        // Doctors can see their patients
        sqlQuery = `
          SELECT DISTINCT u.id, u.full_name, u.email, u.phone 
          FROM users u 
          JOIN appointments a ON u.id = a.patient_id 
          WHERE a.doctor_id = $1 
          AND u.role_id = (SELECT id FROM roles WHERE name = 'patient')
        `
        params.push(req.user.id)
      } else if (req.user.role === "clinic_admin") {
        // Admins can see all patients
        sqlQuery = `
          SELECT id, full_name, email, phone 
          FROM users 
          WHERE role_id = (SELECT id FROM roles WHERE name = 'patient')
        `
      } else {
        // Other roles can't search patients
        return res.status(403).json({ error: "Unauthorized role for patient search" })
      }

      // Add name/email search condition
      if (query) {
        const paramIndex = params.length + 1

        if (exact) {
          conditions.push(`(full_name = $${paramIndex} OR email = $${paramIndex})`)
          params.push(query)
        } else {
          conditions.push(`(full_name ILIKE $${paramIndex} OR email ILIKE $${paramIndex})`)
          params.push(`%${query}%`)
        }
      }

      // Add phone search condition
      if (phone) {
        const paramIndex = params.length + 1
        conditions.push(`phone = $${paramIndex}`)
        params.push(phone)
      }

      // Add conditions to query
      if (conditions.length > 0) {
        sqlQuery += " AND " + conditions.join(" AND ")
      }

      // Execute query
      const result = await pool.query(sqlQuery, params)

      // Provide fallback results for admins only if search was performed but returned no results
      if (result.rows.length === 0 && req.user.role === "clinic_admin" && (query || phone)) {
        const fallbackResult = await pool.query(
          "SELECT id, full_name, email, phone FROM users WHERE role_id = (SELECT id FROM roles WHERE name = 'patient') LIMIT 5",
        )
        return res.json(fallbackResult.rows)
      }

      // Log search
      logger.info(`Patient search by ${req.user.email}: query=${query}, phone=${phone}, exact=${exact}`)

      // Return results
      res.json(result.rows)
    } catch (err) {
      logger.error(`Patient search error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  /**
   * Search for doctors based on query parameters
   */
  static async searchDoctors(req, res) {
    // Get search parameters
    const query = req.query.query
    const specialty = req.query.specialty
    const exact = req.query.exact === "true"
    const license = req.query.license

    try {
      // Require at least one search parameter
      if (!query && !specialty && !license) {
        return res
          .status(400)
          .json({ error: "At least one search parameter (query, specialty, or license) is required" })
      }

      // Base query for doctors
      let sqlQuery = `
        SELECT u.id, u.full_name, u.email, dp.specialty, dp.license_number 
        FROM users u 
        LEFT JOIN doctor_portfolios dp ON u.id = dp.doctor_id 
        WHERE u.role_id = (SELECT id FROM roles WHERE name = 'doctor')
      `

      // Initialize parameters and conditions
      const params = []
      const conditions = []

      // Add name/email search condition
      if (query) {
        const paramIndex = params.length + 1

        if (exact) {
          conditions.push(`(full_name = $${paramIndex} OR email = $${paramIndex})`)
          params.push(query)
        } else {
          conditions.push(`(full_name ILIKE $${paramIndex} OR email ILIKE $${paramIndex})`)
          params.push(`%${query}%`)
        }
      }

      // Add specialty search condition
      if (specialty) {
        const paramIndex = params.length + 1
        conditions.push(`dp.specialty = $${paramIndex}`)
        params.push(specialty)
      }

      // Add license search condition
      if (license) {
        const paramIndex = params.length + 1
        conditions.push(`dp.license_number = $${paramIndex}`)
        params.push(license)
      }

      // Add conditions to query
      if (conditions.length > 0) {
        sqlQuery += " AND " + conditions.join(" AND ")
      }

      // Execute query
      const result = await pool.query(sqlQuery, params)

      // Log search
      logger.info(
        `Doctor search by ${req.user.email}: query=${query}, specialty=${specialty}, license=${license}, exact=${exact}`,
      )

      // Return results
      res.json(result.rows)
    } catch (err) {
      logger.error(`Doctor search error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  /**
   * Search for appointments based on query parameters
   */
  static async searchAppointments(req, res) {
    // Get search parameters
    const query = req.query.query
    const date = req.query.date
    const status = req.query.status
    const type = req.query.type

    try {
      // Require at least one search parameter
      if (!query && !date && !status && !type) {
        return res
          .status(400)
          .json({ error: "At least one search parameter (query, date, status, or type) is required" })
      }

      // Initialize query variables
      let sqlQuery = ""
      const params = []
      const conditions = []

      // Set base query based on user role
      if (req.user.role === "patient") {
        // Patients see their appointments
        sqlQuery = `
          SELECT a.id, a.status, a.type, a.reason, a.created_at, a.slot_id, 
                 u.full_name AS doctor_name, c.name AS clinic_name 
          FROM appointments a 
          JOIN users u ON a.doctor_id = u.id 
          JOIN clinics c ON a.clinic_id = c.id 
          WHERE a.patient_id = $1
        `
        params.push(req.user.id)
      } else if (req.user.role === "doctor") {
        // Doctors see appointments with their patients
        sqlQuery = `
          SELECT a.id, a.status, a.type, a.reason, a.created_at, a.slot_id, 
                 u.full_name AS patient_name, c.name AS clinic_name 
          FROM appointments a 
          JOIN users u ON a.patient_id = u.id 
          JOIN clinics c ON a.clinic_id = c.id 
          WHERE a.doctor_id = $1
        `
        params.push(req.user.id)
      } else if (req.user.role === "clinic_admin") {
        // Admins see all appointments
        sqlQuery = `
          SELECT a.id, a.status, a.type, a.reason, a.created_at, a.slot_id, 
                 up.full_name AS patient_name, ud.full_name AS doctor_name, c.name AS clinic_name 
          FROM appointments a 
          JOIN users up ON a.patient_id = up.id 
          JOIN users ud ON a.doctor_id = ud.id 
          JOIN clinics c ON a.clinic_id = c.id
        `
      } else {
        // Other roles can't search appointments
        return res.status(403).json({ error: "Unauthorized role for appointment search" })
      }

      // Add general search condition
      if (query) {
        const paramIndex = params.length + 1
        conditions.push(
          `(u.full_name ILIKE $${paramIndex} OR c.name ILIKE $${paramIndex} OR a.reason ILIKE $${paramIndex})`,
        )
        params.push(`%${query}%`)
      }

      // Add date search condition
      if (date) {
        const paramIndex = params.length + 1
        conditions.push(`DATE(a.created_at) = $${paramIndex}`)
        params.push(date)
      }

      // Add status search condition
      if (status) {
        const paramIndex = params.length + 1
        conditions.push(`a.status = $${paramIndex}`)
        params.push(status)
      }

      // Add type search condition
      if (type) {
        const paramIndex = params.length + 1
        conditions.push(`a.type = $${paramIndex}`)
        params.push(type)
      }

      // Add conditions to query
      if (conditions.length > 0) {
        sqlQuery += " AND " + conditions.join(" AND ")
      }

      // Add sorting
      sqlQuery += " ORDER BY a.created_at DESC"

      // Execute query
      const result = await pool.query(sqlQuery, params)

      // Log search
      logger.info(
        `Appointment search by ${req.user.email}: query=${query}, date=${date}, status=${status}, type=${type}`,
      )

      // Return results
      res.json(result.rows)
    } catch (err) {
      logger.error(`Appointment search error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }
}

module.exports = SearchController
