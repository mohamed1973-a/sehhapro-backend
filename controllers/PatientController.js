const { executeQuery } = require("../utils/dbUtils")
const logger = require("../middleware/logger")
const asyncHandler = require("../utils/asyncHandler")

class PatientController {
  /**
   * Get all patients
   */
  static async getAll(req, res) {
    try {
      let query,
        params = []

      // Different queries based on user role
      switch (req.user.role) {
        case "doctor":
          // Doctors see patients from their appointments
          query = `
            SELECT DISTINCT u.id, u.full_name, u.email, u.phone, u.created_at, u.updated_at
            FROM users u
            JOIN appointments a ON u.id = a.patient_id
            WHERE a.doctor_id = $1 AND u.role_id = (SELECT id FROM roles WHERE name = 'patient')
            ORDER BY u.full_name
          `
          params = [req.user.id]
          break

        case "clinic_admin":
        case "platform_admin":
          // Admins see all patients
          query = `
            SELECT u.id, u.full_name, u.email, u.phone, u.created_at, u.updated_at
            FROM users u
            WHERE u.role_id = (SELECT id FROM roles WHERE name = 'patient')
            ORDER BY u.full_name
          `
          break

        default:
          return res.status(403).json({ error: "Access denied" })
      }

      const result = await executeQuery(query, params)
      res.status(200).json({ success: true, data: result.rows })
    } catch (err) {
      logger.error(`Get all patients error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  /**
   * Search patients (for doctors) - FIXED VERSION
   */
  static async search(req, res) {
    try {
      const { q = "", limit = 10 } = req.query
      const searchTerm = `%${q}%`

      let query, params

      if (req.user.role === "doctor") {
        // Doctors can only search their patients - REMOVED medical_conditions
        query = `
          SELECT DISTINCT u.id, u.full_name, u.email, u.phone, u.created_at,
                 pmp.allergies, pmp.emergency_contact_name, pmp.emergency_contact_phone
          FROM users u
          LEFT JOIN patient_medical_profiles pmp ON u.id = pmp.patient_id
          JOIN appointments a ON u.id = a.patient_id
          WHERE a.doctor_id = $1
            AND u.role_id = (SELECT id FROM roles WHERE name = 'patient')
            AND (
              LOWER(u.full_name) LIKE LOWER($2) OR
              LOWER(u.email) LIKE LOWER($2) OR
              u.phone LIKE $2
            )
          ORDER BY u.full_name
          LIMIT $3
        `
        params = [req.user.id, searchTerm, limit]
      } else {
        // Admins can search all patients - REMOVED medical_conditions
        query = `
          SELECT u.id, u.full_name, u.email, u.phone, u.created_at,
                 pmp.allergies, pmp.emergency_contact_name, pmp.emergency_contact_phone
          FROM users u
          LEFT JOIN patient_medical_profiles pmp ON u.id = pmp.patient_id
          WHERE u.role_id = (SELECT id FROM roles WHERE name = 'patient')
            AND (
              LOWER(u.full_name) LIKE LOWER($1) OR
              LOWER(u.email) LIKE LOWER($1) OR
              u.phone LIKE $1
            )
          ORDER BY u.full_name
          LIMIT $2
        `
        params = [searchTerm, limit]
      }

      const result = await executeQuery(query, params)

      // Parse JSON fields safely
      const patients = result.rows.map((patient) => ({
        ...patient,
        allergies: patient.allergies
          ? typeof patient.allergies === "string"
            ? JSON.parse(patient.allergies)
            : patient.allergies
          : [],
      }))

      res.status(200).json({ success: true, data: patients })
    } catch (err) {
      logger.error(`Search patients error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  /**
   * Get patient profile (for the logged-in patient)
   */
  static async getProfile(req, res) {
    try {
      const patientId = req.user.id

      // Get patient basic info
      const patientQuery = `
        SELECT u.id, u.full_name, u.email, u.phone, u.created_at, u.updated_at
        FROM users u
        WHERE u.id = $1 AND u.role_id = (SELECT id FROM roles WHERE name = 'patient')
      `

      const patientResult = await executeQuery(patientQuery, [patientId])

      if (patientResult.rows.length === 0) {
        return res.status(404).json({ error: "Patient profile not found" })
      }

      // Get medical profile if exists - REMOVED medical_conditions
      const medicalQuery = `
        SELECT emergency_contact_name, emergency_contact_phone, allergies,
               insurance_provider, insurance_policy_number,
               created_at, updated_at
        FROM patient_medical_profiles
        WHERE patient_id = $1
      `

      const medicalResult = await executeQuery(medicalQuery, [patientId])

      const profile = {
        ...patientResult.rows[0],
        medical_profile: medicalResult.rows[0] || null,
      }

      res.status(200).json({ success: true, data: profile })
    } catch (err) {
      logger.error(`Get patient profile error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  /**
   * Update patient profile
   */
  static async updateProfile(req, res) {
    try {
      const patientId = req.user.id
      const {
        full_name,
        email,
        phone,
        emergency_contact_name,
        emergency_contact_phone,
        allergies,
        insurance_provider,
        insurance_policy_number,
      } = req.body

      // Update basic user info
      if (full_name || email || phone) {
        const userUpdateQuery = `
          UPDATE users 
          SET full_name = COALESCE($1, full_name),
              email = COALESCE($2, email),
              phone = COALESCE($3, phone),
              updated_at = NOW()
          WHERE id = $4
        `
        await executeQuery(userUpdateQuery, [full_name, email, phone, patientId])
      }

      // Update or insert medical profile - REMOVED medical_conditions
      const medicalFields = {
        emergency_contact_name,
        emergency_contact_phone,
        allergies,
        insurance_provider,
        insurance_policy_number,
      }

      // Check if medical profile exists
      const existingMedicalQuery = `SELECT id FROM patient_medical_profiles WHERE patient_id = $1`
      const existingMedical = await executeQuery(existingMedicalQuery, [patientId])

      if (existingMedical.rows.length > 0) {
        // Update existing medical profile
        const medicalUpdateQuery = `
          UPDATE patient_medical_profiles 
          SET emergency_contact_name = COALESCE($1, emergency_contact_name),
              emergency_contact_phone = COALESCE($2, emergency_contact_phone),
              allergies = COALESCE($3, allergies),
              insurance_provider = COALESCE($4, insurance_provider),
              insurance_policy_number = COALESCE($5, insurance_policy_number),
              updated_at = NOW()
          WHERE patient_id = $6
        `
        await executeQuery(medicalUpdateQuery, [
          emergency_contact_name,
          emergency_contact_phone,
          allergies ? JSON.stringify(allergies) : null,
          insurance_provider,
          insurance_policy_number,
          patientId,
        ])
      } else {
        // Insert new medical profile
        const medicalInsertQuery = `
          INSERT INTO patient_medical_profiles 
          (patient_id, emergency_contact_name, emergency_contact_phone, allergies, 
           insurance_provider, insurance_policy_number)
          VALUES ($1, $2, $3, $4, $5, $6)
        `
        await executeQuery(medicalInsertQuery, [
          patientId,
          emergency_contact_name,
          emergency_contact_phone,
          allergies ? JSON.stringify(allergies) : null,
          insurance_provider,
          insurance_policy_number,
        ])
      }

      res.status(200).json({ message: "Patient profile updated successfully" })
    } catch (err) {
      logger.error(`Update patient profile error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  /**
   * Create new patient
   */
  static async create(req, res) {
    try {
      const { full_name, email, phone } = req.body

      if (!full_name || !email) {
        return res.status(400).json({ error: "Full name and email are required" })
      }

      // Check if email already exists
      const existingUserQuery = `SELECT id FROM users WHERE email = $1`
      const existingUser = await executeQuery(existingUserQuery, [email])

      if (existingUser.rows.length > 0) {
        return res.status(400).json({ error: "Email already exists" })
      }

      // Create new patient user
      const createUserQuery = `
        INSERT INTO users (full_name, email, phone, role_id, password_hash)
        VALUES ($1, $2, $3, (SELECT id FROM roles WHERE name = 'patient'), $4)
        RETURNING id, full_name, email, phone, created_at
      `

      // Generate a temporary password hash
      const bcrypt = require("bcrypt")
      const tempPassword = "TempPassword123!"
      const passwordHash = await bcrypt.hash(tempPassword, 10)

      const result = await executeQuery(createUserQuery, [full_name, email, phone, passwordHash])

      res.status(201).json({
        success: true,
        data: result.rows[0],
        message: "Patient created successfully",
      })
    } catch (err) {
      logger.error(`Create patient error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  /**
   * Get patient by ID
   */
  static async getById(req, res) {
    try {
      const { id } = req.params

      const query = `
        SELECT u.id, u.full_name, u.email, u.phone, u.created_at, u.updated_at
        FROM users u
        WHERE u.id = $1 AND u.role_id = (SELECT id FROM roles WHERE name = 'patient')
      `

      const result = await executeQuery(query, [id])

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Patient not found" })
      }

      res.status(200).json({ success: true, data: result.rows[0] })
    } catch (err) {
      logger.error(`Get patient by ID error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  /**
   * Update patient
   */
  static async update(req, res) {
    try {
      const { id } = req.params
      const { full_name, email, phone } = req.body

      // Check authorization
      if (req.user.role === "patient" && req.user.id !== Number.parseInt(id)) {
        return res.status(403).json({ error: "Not authorized to update this profile" })
      }

      const query = `
        UPDATE users 
        SET full_name = COALESCE($1, full_name),
            email = COALESCE($2, email),
            phone = COALESCE($3, phone),
            updated_at = NOW()
        WHERE id = $4 AND role_id = (SELECT id FROM roles WHERE name = 'patient')
        RETURNING *
      `

      const result = await executeQuery(query, [full_name, email, phone, id])

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Patient not found" })
      }

      res.status(200).json({
        message: "Patient updated successfully",
        patient: result.rows[0],
      })
    } catch (err) {
      logger.error(`Update patient error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }
}

module.exports = PatientController
