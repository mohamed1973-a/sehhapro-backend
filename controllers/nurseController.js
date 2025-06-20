/**
 * Nurse Controller
 *
 * Manages nurse-related operations and patient relationships.
 */
const { pool } = require("../config/database")
const logger = require("../middleware/logger")
const asyncHandler = require("../utils/asyncHandler")

class NurseController {
  /**
   * Gets all nurses with optional filtering
   */
  static getAllNurses = asyncHandler(async (req, res) => {
    const { search, specialty } = req.query

    // Build query with optional filters
    let query = `
      SELECT u.id, u.full_name, u.email, u.phone, 
             np.specialty, np.years_experience, np.license_number 
      FROM users u 
      JOIN roles r ON u.role_id = r.id 
      LEFT JOIN nurse_portfolios np ON u.id = np.nurse_id 
      WHERE r.name = 'nurse'
    `

    const params = []
    const conditions = []

    // Add search filter if provided
    if (search) {
      conditions.push(`(u.full_name ILIKE $${params.length + 1} OR u.email ILIKE $${params.length + 1})`)
      params.push(`%${search}%`)
    }

    // Add specialty filter if provided
    if (specialty) {
      conditions.push(`np.specialty = $${params.length + 1}`)
      params.push(specialty)
    }

    // Add conditions to query
    if (conditions.length > 0) {
      query += " AND " + conditions.join(" AND ")
    }

    query += " ORDER BY u.full_name"

    const result = await pool.query(query, params)
    logger.info(`Retrieved ${result.rows.length} nurses`)
    res.status(200).json(result.rows)
  })

  /**
   * Gets a nurse's professional portfolio
   */
  static getPortfolio = asyncHandler(async (req, res) => {
    const nurseId = req.params.id || req.user.id

    // Get nurse basic info and portfolio
    const result = await pool.query(
      `SELECT u.id, u.full_name, u.email, u.phone, np.* 
       FROM users u 
       LEFT JOIN nurse_portfolios np ON u.id = np.nurse_id 
       WHERE u.id = $1`,
      [nurseId],
    )

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Nurse not found" })
    }

    // Get associated clinics
    const clinicsResult = await pool.query(
      `SELECT c.id, c.name, c.address, c.phone, c.email 
       FROM clinics c 
       JOIN nurse_clinics nc ON c.id = nc.clinic_id 
       WHERE nc.nurse_id = $1`,
      [nurseId],
    )

    // Combine all data
    const nurse = {
      ...result.rows[0],
      clinics: clinicsResult.rows,
    }

    logger.info(`Nurse portfolio retrieved for: ${nurseId}`)
    res.status(200).json(nurse)
  })

  /**
   * Updates a nurse's professional portfolio
   */
  static updatePortfolio = asyncHandler(async (req, res) => {
    const nurseId = req.params.id || req.user.id
    const { specialty, yearsExperience, education, certifications, languages, profilePicture, bio, licenseNumber } =
      req.body

    // Check authorization
    if (req.user.id !== Number.parseInt(nurseId) && req.user.role !== "clinic_admin") {
      return res.status(403).json({ error: "Not authorized to update this profile" })
    }

    // Verify nurse exists
    const nurseCheck = await pool.query(
      "SELECT 1 FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = $1 AND r.name = 'nurse'",
      [nurseId],
    )

    if (nurseCheck.rows.length === 0) {
      return res.status(404).json({ error: "Nurse not found" })
    }

    // Update portfolio with UPSERT
    const result = await pool.query(
      `INSERT INTO nurse_portfolios 
       (nurse_id, specialty, years_experience, education, certifications, languages, profile_picture, bio, license_number) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (nurse_id) 
       DO UPDATE SET 
         specialty = COALESCE($2, nurse_portfolios.specialty),
         years_experience = COALESCE($3, nurse_portfolios.years_experience),
         education = COALESCE($4, nurse_portfolios.education),
         certifications = COALESCE($5, nurse_portfolios.certifications),
         languages = COALESCE($6, nurse_portfolios.languages),
         profile_picture = COALESCE($7, nurse_portfolios.profile_picture),
         bio = COALESCE($8, nurse_portfolios.bio),
         license_number = COALESCE($9, nurse_portfolios.license_number),
         updated_at = NOW()
       RETURNING *`,
      [
        nurseId,
        specialty,
        yearsExperience,
        education ? JSON.stringify(education) : null,
        certifications ? JSON.stringify(certifications) : null,
        languages ? JSON.stringify(languages) : null,
        profilePicture,
        bio,
        licenseNumber,
      ],
    )

    logger.info(`Nurse portfolio updated for: ${nurseId}`)
    res.status(200).json({
      message: "Nurse portfolio updated successfully",
      profile: result.rows[0],
    })
  })

  /**
   * Gets all patients associated with a nurse
   */
  static async getPatients(req, res) {
    try {
      const result = await pool.query(
        "SELECT DISTINCT u.id, u.full_name, u.email FROM users u JOIN appointments a ON u.id = a.patient_id WHERE a.doctor_id = $1 ORDER BY u.full_name",
        [req.user.id],
      )
      res.json(result.rows)
    } catch (err) {
      logger.error(`Get patients error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  /**
   * Deletes a nurse and related records (admin function)
   */
  static deleteNurse = asyncHandler(async (req, res) => {
    const { id } = req.params

    // Verify nurse exists
    const nurseCheck = await pool.query(
      "SELECT 1 FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = $1 AND r.name = 'nurse'",
      [id],
    )

    if (nurseCheck.rows.length === 0) {
      return res.status(404).json({ error: "Nurse not found" })
    }

    // Delete nurse and related data in a transaction
    await pool.query("BEGIN")

    try {
      // Delete associations
      await pool.query("DELETE FROM nurse_clinics WHERE nurse_id = $1", [id])
      await pool.query("DELETE FROM nurse_portfolios WHERE nurse_id = $1", [id])

      // Delete the user
      await pool.query("DELETE FROM users WHERE id = $1", [id])

      await pool.query("COMMIT")

      logger.info(`Nurse deleted: ${id}`)
      res.status(200).json({ message: "Nurse deleted successfully" })
    } catch (error) {
      await pool.query("ROLLBACK")
      throw error
    }
  })
}

module.exports = NurseController
