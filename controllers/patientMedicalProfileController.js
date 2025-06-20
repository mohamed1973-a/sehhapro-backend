const { pool } = require("../config/database")
const logger = require("../middleware/logger")
const { executeQuery } = require("../utils/dbUtils")

const PatientMedicalProfileController = {
  // Get a patient's medical profile
  async getMedicalProfile(req, res) {
    try {
      const patientId = req.params.id
      const userId = req.user.id
      const userRole = req.user.role

      // Check if user has permission to access this patient's profile
      if (userRole === "patient" && userId !== Number.parseInt(patientId)) {
        return res.status(403).json({ success: false, error: "Access denied" })
      }

      // First check if the patient_medical_profiles table exists
      const tableCheckQuery = `
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'patient_medical_profiles'
        );
      `

      const tableExists = await executeQuery(tableCheckQuery)

      if (!tableExists.rows[0].exists) {
        logger.warn("patient_medical_profiles table does not exist")
        return res.status(200).json({
          success: true,
          data: {
            id: patientId,
            patient_id: patientId,
            allergies: [],
            chronic_conditions: [],
            current_medications: [],
            medical_history: "",
          },
        })
      }

      // Check what columns exist in the table
      const columnsQuery = `
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'patient_medical_profiles';
      `

      const columnsResult = await executeQuery(columnsQuery)
      const availableColumns = columnsResult.rows.map((row) => row.column_name)

      logger.info(`Available columns in patient_medical_profiles: ${availableColumns.join(", ")}`)

      // Build a dynamic query based on available columns
      const selectColumns = ["id", "patient_id"]

      // Add columns that might exist
      const possibleColumns = [
        "allergies",
        "chronic_conditions",
        "current_medications",
        "medical_history",
        "blood_type",
        "height",
        "weight",
        "emergency_contact_name",
        "emergency_contact_phone",
        "emergency_contact_relationship",
        "insurance_provider",
        "insurance_policy_number",
      ]

      possibleColumns.forEach((col) => {
        if (availableColumns.includes(col)) {
          selectColumns.push(col)
        }
      })

      // Build and execute the query
      const query = `
        SELECT ${selectColumns.join(", ")}
        FROM patient_medical_profiles
        WHERE patient_id = $1
      `

      const result = await executeQuery(query, [patientId])

      // If no profile found, return empty data
      if (result.rows.length === 0) {
        logger.info(`No medical profile found for patient ${patientId}`)

        // Create an empty profile object with all possible fields
        const emptyProfile = {
          id: null,
          patient_id: patientId,
        }

        possibleColumns.forEach((col) => {
          if (col === "allergies" || col === "chronic_conditions" || col === "current_medications") {
            emptyProfile[col] = []
          } else {
            emptyProfile[col] = null
          }
        })

        return res.status(200).json({ success: true, data: emptyProfile })
      }

      // Process the result to ensure arrays are properly formatted
      const profile = result.rows[0]

      // Convert string arrays to actual arrays if they're stored as strings
      ;["allergies", "chronic_conditions", "current_medications"].forEach((field) => {
        if (profile[field]) {
          if (typeof profile[field] === "string") {
            try {
              profile[field] = JSON.parse(profile[field])
            } catch (e) {
              // If parsing fails, assume it's a comma-separated string
              profile[field] = profile[field].split(",").map((item) => item.trim())
            }
          }
        } else {
          profile[field] = []
        }
      })

      logger.info(`Successfully retrieved medical profile for patient ${patientId}`)
      res.status(200).json({ success: true, data: profile })
    } catch (error) {
      logger.error(`Get medical profile error: ${error.message}`)
      logger.error(`Stack trace: ${error.stack}`)
      res.status(500).json({ success: false, error: "Server error", details: error.message })
    }
  },

  // Update a patient's medical profile
  async updateMedicalProfile(req, res) {
    try {
      const patientId = req.params.id
      const userId = req.user.id
      const userRole = req.user.role
      const profileData = req.body

      // Check if user has permission to update this patient's profile
      if (userRole === "patient" && userId !== Number.parseInt(patientId)) {
        return res.status(403).json({ success: false, error: "Access denied" })
      }

      // Check if the patient_medical_profiles table exists
      const tableCheckQuery = `
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'patient_medical_profiles'
        );
      `

      const tableExists = await executeQuery(tableCheckQuery)

      if (!tableExists.rows[0].exists) {
        logger.warn("patient_medical_profiles table does not exist")
        return res.status(404).json({ success: false, error: "Medical profiles feature not available" })
      }

      // Check what columns exist in the table
      const columnsQuery = `
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'patient_medical_profiles';
      `

      const columnsResult = await executeQuery(columnsQuery)
      const availableColumns = columnsResult.rows.map((row) => row.column_name)

      // Check if profile exists
      const checkQuery = `
        SELECT id FROM patient_medical_profiles WHERE patient_id = $1
      `

      const checkResult = await executeQuery(checkQuery, [patientId])
      const profileExists = checkResult.rows.length > 0

      // Prepare data for update or insert
      const updateData = {}
      Object.keys(profileData).forEach((key) => {
        if (availableColumns.includes(key) && key !== "id" && key !== "patient_id") {
          // Convert arrays to JSON strings if needed
          if (Array.isArray(profileData[key])) {
            updateData[key] = JSON.stringify(profileData[key])
          } else {
            updateData[key] = profileData[key]
          }
        }
      })

      let result

      if (profileExists) {
        // Update existing profile
        const setClause = Object.keys(updateData)
          .map((key, index) => `${key} = $${index + 2}`)
          .join(", ")

        const updateQuery = `
          UPDATE patient_medical_profiles
          SET ${setClause}
          WHERE patient_id = $1
          RETURNING *
        `

        const params = [patientId, ...Object.values(updateData)]
        result = await executeQuery(updateQuery, params)
      } else {
        // Insert new profile
        const columns = ["patient_id", ...Object.keys(updateData)]
        const placeholders = columns.map((_, index) => `$${index + 1}`)

        const insertQuery = `
          INSERT INTO patient_medical_profiles (${columns.join(", ")})
          VALUES (${placeholders.join(", ")})
          RETURNING *
        `

        const params = [patientId, ...Object.values(updateData)]
        result = await executeQuery(insertQuery, params)
      }

      // Process the result to ensure arrays are properly formatted
      const profile = result.rows[0]

      // Convert string arrays to actual arrays
      ;["allergies", "chronic_conditions", "current_medications"].forEach((field) => {
        if (profile[field]) {
          if (typeof profile[field] === "string") {
            try {
              profile[field] = JSON.parse(profile[field])
            } catch (e) {
              profile[field] = profile[field].split(",").map((item) => item.trim())
            }
          }
        } else {
          profile[field] = []
        }
      })

      logger.info(`Successfully updated medical profile for patient ${patientId}`)
      res.status(200).json({ success: true, data: profile })
    } catch (error) {
      logger.error(`Update medical profile error: ${error.message}`)
      logger.error(`Stack trace: ${error.stack}`)
      res.status(500).json({ success: false, error: "Server error", details: error.message })
    }
  },
}

module.exports = PatientMedicalProfileController
