/**
 * User utility functions
 */
const { pool } = require("../config/database")
const logger = require("../middleware/logger")

/**
 * Links a user to a clinic based on their role
 * @param {number} userId - User ID
 * @param {number} clinicId - Clinic ID
 * @param {string} role - User role
 * @param {boolean} isPrimary - Whether this is the primary clinic for the user
 * @returns {Promise<boolean>} Success status
 */
async function linkUserToClinic(userId, clinicId, role, isPrimary = true) {
  try {
    // Verify clinic exists
    const clinicCheck = await pool.query("SELECT id FROM clinics WHERE id = $1", [clinicId])
    if (clinicCheck.rows.length === 0) {
      throw new Error("Invalid clinicId")
    }

    // Configuration for different user types
    const config = {
      doctor: {
        tableName: "doctor_clinics",
        idColumn: "doctor_id",
        hasPrimary: false,
      },
      nurse: {
        tableName: "nurse_clinics",
        idColumn: "nurse_id",
        hasPrimary: false,
      },
      lab: {
        tableName: "lab_clinics",
        idColumn: "lab_id",
        hasPrimary: false,
      },
      patient: {
        tableName: "patient_clinics",
        idColumn: "patient_id",
        hasPrimary: true,
      },
      clinic_admin: {
        tableName: "admin_clinics",
        idColumn: "admin_id",
        hasPrimary: true,
      },
      lab_admin: {
        tableName: "admin_clinics",
        idColumn: "admin_id",
        hasPrimary: true,
      },
    }

    const typeConfig = config[role]
    if (!typeConfig) {
      throw new Error(`Invalid role: ${role}`)
    }

    // Check if table exists
    const tableCheck = await pool.query(`SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)`, [
      typeConfig.tableName,
    ])

    if (!tableCheck.rows[0].exists) {
      // Create the table if it doesn't exist
      let createTableSQL = `
        CREATE TABLE ${typeConfig.tableName} (
          id SERIAL PRIMARY KEY,
          ${typeConfig.idColumn} INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
          created_at TIMESTAMP DEFAULT NOW(),
          UNIQUE(${typeConfig.idColumn}, clinic_id)
        )
      `

      // Add is_primary column for tables that need it
      if (typeConfig.hasPrimary) {
        createTableSQL = `
          CREATE TABLE ${typeConfig.tableName} (
            id SERIAL PRIMARY KEY,
            ${typeConfig.idColumn} INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            clinic_id INTEGER NOT NULL REFERENCES clinics(id) ON DELETE CASCADE,
            is_primary BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(${typeConfig.idColumn}, clinic_id)
          )
        `
      }

      await pool.query(createTableSQL)
      logger.info(`Created ${typeConfig.tableName} table`)
    }

    // Insert the association
    if (typeConfig.hasPrimary) {
      await pool.query(
        `INSERT INTO ${typeConfig.tableName} (${typeConfig.idColumn}, clinic_id, is_primary) 
         VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [userId, clinicId, isPrimary],
      )
    } else {
      await pool.query(
        `INSERT INTO ${typeConfig.tableName} (${typeConfig.idColumn}, clinic_id) 
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userId, clinicId],
      )
    }

    logger.info(`User ${userId} (${role}) linked to clinic ${clinicId}`)
    return true
  } catch (error) {
    logger.error(`Error linking user ${userId} to clinic ${clinicId}: ${error.message}`)
    throw error
  }
}

module.exports = {
  linkUserToClinic,
}
