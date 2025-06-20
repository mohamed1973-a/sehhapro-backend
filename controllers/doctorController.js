const { executeQuery } = require("../utils/dbUtils")
const logger = require("../middleware/logger")
const asyncHandler = require("../utils/asyncHandler")

class DoctorController {
  /**
   * Get all doctors
   */
  static async getAll(req, res) {
    try {
      const query = `
        SELECT u.id, u.full_name, u.email, u.phone, 
               dp.specialty, dp.license_number, dp.years_experience,
               dp.education, dp.certifications, dp.languages,
               dp.consultation_fee, dp.bio, dp.available_for_telemedicine
        FROM users u
        JOIN doctor_portfolios dp ON u.id = dp.doctor_id
        WHERE u.role_id = (SELECT id FROM roles WHERE name = 'doctor')
        ORDER BY u.full_name
      `

      const result = await executeQuery(query)
      res.status(200).json({ success: true, data: result.rows })
    } catch (err) {
      logger.error(`Get all doctors error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  /**
   * Get doctors by clinic
   */
  static async getByClinic(req, res) {
    try {
      const { clinicId } = req.query

      if (!clinicId) {
        return res.status(400).json({ error: "Clinic ID is required" })
      }

      const query = `
        SELECT u.id, u.full_name, u.email, u.phone, 
               dp.specialty, dp.license_number, dp.years_experience,
               dp.education, dp.certifications, dp.languages,
               dp.consultation_fee, dp.bio, dp.available_for_telemedicine
        FROM users u
        JOIN doctor_portfolios dp ON u.id = dp.doctor_id
        JOIN doctor_clinics dc ON u.id = dc.doctor_id
        WHERE u.role_id = (SELECT id FROM roles WHERE name = 'doctor')
        AND dc.clinic_id = $1
        ORDER BY u.full_name
      `

      const result = await executeQuery(query, [clinicId])
      res.status(200).json({ success: true, data: result.rows })
    } catch (err) {
      logger.error(`Get doctors by clinic error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  /**
   * Get doctor by ID
   */
  static async getById(req, res) {
    try {
      const { id } = req.params

      const query = `
        SELECT u.id, u.full_name, u.email, u.phone, 
               dp.specialty, dp.license_number, dp.years_experience,
               dp.education, dp.certifications, dp.languages,
               dp.consultation_fee, dp.bio, dp.available_for_telemedicine
        FROM users u
        JOIN doctor_portfolios dp ON u.id = dp.doctor_id
        WHERE u.id = $1 AND u.role_id = (SELECT id FROM roles WHERE name = 'doctor')
      `

      const result = await executeQuery(query, [id])

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Doctor not found" })
      }

      res.status(200).json({ success: true, data: result.rows[0] })
    } catch (err) {
      logger.error(`Get doctor by ID error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  /**
   * Get doctor's patients
   */
  static async getPatients(req, res) {
    try {
      const { id } = req.params
      const doctorId = req.user.role === "doctor" ? req.user.id : id

      const query = `
        SELECT DISTINCT u.id, u.full_name, u.email, u.phone, u.created_at
        FROM users u
        JOIN appointments a ON u.id = a.patient_id
        WHERE a.doctor_id = $1 AND u.role_id = (SELECT id FROM roles WHERE name = 'patient')
        ORDER BY u.full_name
      `

      const result = await executeQuery(query, [doctorId])
      res.status(200).json({ success: true, data: result.rows })
    } catch (err) {
      logger.error(`Get doctor patients error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  /**
   * Update doctor profile
   */
  static async update(req, res) {
    try {
      const { id } = req.params
      const { full_name, email, phone, specialty, bio, consultation_fee } = req.body

      // Check authorization
      if (req.user.role === "doctor" && req.user.id !== Number.parseInt(id)) {
        return res.status(403).json({ error: "Not authorized to update this profile" })
      }

      // Update user table
      if (full_name || email || phone) {
        const userUpdateQuery = `
          UPDATE users 
          SET full_name = COALESCE($1, full_name),
              email = COALESCE($2, email),
              phone = COALESCE($3, phone),
              updated_at = NOW()
          WHERE id = $4
        `
        await executeQuery(userUpdateQuery, [full_name, email, phone, id])
      }

      // Update doctor portfolio
      if (specialty || bio || consultation_fee) {
        const portfolioUpdateQuery = `
          UPDATE doctor_portfolios 
          SET specialty = COALESCE($1, specialty),
              bio = COALESCE($2, bio),
              consultation_fee = COALESCE($3, consultation_fee),
              updated_at = NOW()
          WHERE doctor_id = $4
        `
        await executeQuery(portfolioUpdateQuery, [specialty, bio, consultation_fee, id])
      }

      res.status(200).json({ message: "Doctor profile updated successfully" })
    } catch (err) {
      logger.error(`Update doctor error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  /**
   * Get doctor portfolio
   */
  static async getPortfolio(req, res) {
    try {
      const { id } = req.params
      console.log(`Getting portfolio for doctor ID: ${id}`)

      const query = `
        SELECT u.id, u.full_name, u.email, u.phone, 
               dp.specialty, dp.license_number, dp.years_experience,
               dp.education, dp.certifications, dp.languages,
               dp.consultation_fee, dp.bio, dp.available_for_telemedicine
        FROM users u
        LEFT JOIN doctor_portfolios dp ON u.id = dp.doctor_id
        WHERE u.id = $1 AND u.role_id = (SELECT id FROM roles WHERE name = 'doctor')
      `

      const result = await executeQuery(query, [id])
      console.log(`Database result:`, result.rows)

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Doctor not found" })
      }

      const doctor = result.rows[0]

      // Handle JSON fields - PostgreSQL might return them as arrays or strings
      const parseJsonField = (field, fieldName) => {
        if (!field) {
          return []
        }

        // If it's already an array, return it
        if (Array.isArray(field)) {
          return field
        }

        // If it's a string, try to parse it
        if (typeof field === "string") {
          try {
            const parsed = JSON.parse(field)
            return Array.isArray(parsed) ? parsed : []
          } catch (e) {
            console.log(`Error parsing ${fieldName}:`, e)
            return []
          }
        }

        return []
      }

      doctor.education = parseJsonField(doctor.education, "education")
      doctor.certifications = parseJsonField(doctor.certifications, "certifications")
      doctor.languages = parseJsonField(doctor.languages, "languages")

      console.log(`Returning portfolio data:`, doctor)
      res.status(200).json({ success: true, data: doctor })
    } catch (err) {
      logger.error(`Get doctor portfolio error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  /**
   * Update doctor portfolio
   */
  static async updatePortfolio(req, res) {
    try {
      const { id } = req.params
      const portfolioData = req.body

      console.log(`Updating portfolio for doctor ${id}:`, portfolioData)

      // Check authorization
      if (req.user.id !== Number.parseInt(id)) {
        return res.status(403).json({ error: "Not authorized to update this portfolio" })
      }

      const {
        specialty,
        license_number,
        years_experience,
        education,
        certifications,
        languages,
        consultation_fee,
        bio,
        available_for_telemedicine,
      } = portfolioData

      // Check if portfolio exists
      const checkQuery = `SELECT doctor_id FROM doctor_portfolios WHERE doctor_id = $1`
      const checkResult = await executeQuery(checkQuery, [id])
      console.log(`Portfolio exists check:`, checkResult.rows.length > 0)

      let query
      let params

      if (checkResult.rows.length === 0) {
        // Create new portfolio
        console.log("Creating new portfolio")
        query = `
          INSERT INTO doctor_portfolios 
          (doctor_id, specialty, license_number, years_experience, education, certifications, languages, consultation_fee, bio, available_for_telemedicine, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW())
          RETURNING doctor_id, specialty, license_number, years_experience, education, certifications, languages, consultation_fee, bio, available_for_telemedicine
        `
        params = [
          id,
          specialty || null,
          license_number || null,
          years_experience || 0,
          education && education.length > 0 ? JSON.stringify(education) : null,
          certifications && certifications.length > 0 ? JSON.stringify(certifications) : null,
          languages && languages.length > 0 ? JSON.stringify(languages) : null,
          consultation_fee || 0,
          bio || null,
          available_for_telemedicine || false,
        ]
      } else {
        // Update existing portfolio
        console.log("Updating existing portfolio")
        query = `
          UPDATE doctor_portfolios 
          SET specialty = $1,
              license_number = $2,
              years_experience = $3,
              education = $4,
              certifications = $5,
              languages = $6,
              consultation_fee = $7,
              bio = $8,
              available_for_telemedicine = $9,
              updated_at = NOW()
          WHERE doctor_id = $10
          RETURNING doctor_id, specialty, license_number, years_experience, education, certifications, languages, consultation_fee, bio, available_for_telemedicine
        `
        params = [
          specialty || null,
          license_number || null,
          years_experience || 0,
          education && education.length > 0 ? JSON.stringify(education) : null,
          certifications && certifications.length > 0 ? JSON.stringify(certifications) : null,
          languages && languages.length > 0 ? JSON.stringify(languages) : null,
          consultation_fee || 0,
          bio || null,
          available_for_telemedicine || false,
          id,
        ]
      }

      console.log(`Executing query:`, query)
      console.log(`With params:`, params)

      const result = await executeQuery(query, params)
      console.log(`Query result:`, result.rows)

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Failed to save portfolio" })
      }

      const portfolio = result.rows[0]

      // Handle JSON fields for response - same logic as in getPortfolio
      const parseJsonField = (field, fieldName) => {
        if (!field) {
          return []
        }

        if (Array.isArray(field)) {
          return field
        }

        if (typeof field === "string") {
          try {
            const parsed = JSON.parse(field)
            return Array.isArray(parsed) ? parsed : []
          } catch (e) {
            console.log(`Error parsing ${fieldName} in response:`, e)
            return []
          }
        }

        return []
      }

      portfolio.education = parseJsonField(portfolio.education, "education")
      portfolio.certifications = parseJsonField(portfolio.certifications, "certifications")
      portfolio.languages = parseJsonField(portfolio.languages, "languages")

      console.log(`Returning saved portfolio:`, portfolio)

      res.status(200).json({
        success: true,
        message: "Portfolio saved successfully",
        data: portfolio,
      })
    } catch (err) {
      logger.error(`Update doctor portfolio error: ${err.message}`)
      console.error(`Full error:`, err)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }
}

module.exports = DoctorController
