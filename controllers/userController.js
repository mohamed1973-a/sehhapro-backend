/**
 * User Controller
 *
 * Handles user profile management and CRUD operations.
 */
const { pool } = require("../config/database")
const logger = require("../middleware/logger")
const bcrypt = require("bcryptjs")

class UserController {
  /**
   * Gets all users (Platform Admin only)
   */
  static async getAllUsers(req, res) {
    try {
      const { page = 1, limit = 10, role, status, search } = req.query

      let query = `
SELECT u.id, u.email, u.full_name, u.phone, r.name as role, u.created_at, u.updated_at
FROM users u
LEFT JOIN roles r ON u.role_id = r.id
WHERE 1=1
`
      const queryParams = []
      let paramCount = 0

      // Add filters
      if (role) {
        paramCount++
        query += ` AND r.name = $${paramCount}`
        queryParams.push(role)
      }

      if (search) {
        paramCount++
        query += ` AND (u.full_name ILIKE $${paramCount} OR u.email ILIKE $${paramCount})`
        queryParams.push(`%${search}%`)
      }

      // Add pagination
      const offset = (page - 1) * limit
      paramCount++
      query += ` ORDER BY u.created_at DESC LIMIT $${paramCount}`
      queryParams.push(limit)

      paramCount++
      query += ` OFFSET $${paramCount}`
      queryParams.push(offset)

      const result = await pool.query(query, queryParams)

      // Get total count
      let countQuery = `
SELECT COUNT(*) as total
FROM users u
LEFT JOIN roles r ON u.role_id = r.id
WHERE 1=1
`
      const countParams = []
      let countParamCount = 0

      if (role) {
        countParamCount++
        countQuery += ` AND r.name = $${countParamCount}`
        countParams.push(role)
      }

      if (search) {
        countParamCount++
        countQuery += ` AND (u.full_name ILIKE $${countParamCount} OR u.email ILIKE $${countParamCount})`
        countParams.push(`%${search}%`)
      }

      const countResult = await pool.query(countQuery, countParams)
      const total = Number.parseInt(countResult.rows[0].total)

      res.json({
        success: true,
        data: result.rows,
        pagination: {
          page: Number.parseInt(page),
          limit: Number.parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
        },
      })
    } catch (err) {
      logger.error(`Get all users error: ${err.message}`)
      res.status(500).json({ success: false, error: "Server error", details: err.message })
    }
  }

  /**
   * Gets a specific user by ID
   */
  static async getUserById(req, res) {
    try {
      const { id } = req.params

      // Validate ID is a number
      if (!id || isNaN(Number(id))) {
        return res.status(400).json({ success: false, message: "Invalid user ID" })
      }

      // Fetch base user data including role name and all fields from users table
      const userQuery = `
        SELECT 
          u.id, u.email, u.full_name, u.phone, r.name as role, u.status,
          u.profile_image, u.specialization, u.license_number, 
          u.employment_type, u.start_date, u.emergency_contact,
          u.created_at, u.updated_at, u.last_login
        FROM users u
        LEFT JOIN roles r ON u.role_id = r.id
        WHERE u.id = $1
      `
      const userResult = await pool.query(userQuery, [Number(id)])

      if (!userResult.rows.length) {
        return res.status(404).json({ success: false, message: "User not found" })
      }
      const user = userResult.rows[0]

      // Fetch associated clinic_id and clinic_name for staff roles
      let clinicAssociationQuery = null
      const clinicParams = [Number(id)]

      if (user.role === "doctor") {
        clinicAssociationQuery = `
          SELECT dc.clinic_id, c.name as clinic_name 
          FROM doctor_clinics dc 
          JOIN clinics c ON dc.clinic_id = c.id 
          WHERE dc.doctor_id = $1 
          LIMIT 1
        `
      } else if (user.role === "nurse") {
        clinicAssociationQuery = `
          SELECT nc.clinic_id, c.name as clinic_name 
          FROM nurse_clinics nc 
          JOIN clinics c ON nc.clinic_id = c.id 
          WHERE nc.nurse_id = $1 
          LIMIT 1
        `
      } else if (user.role === "clinic_admin" || user.role === "lab_admin") {
        clinicAssociationQuery = `
          SELECT ac.clinic_id, c.name as clinic_name 
          FROM admin_clinics ac 
          JOIN clinics c ON ac.clinic_id = c.id 
          WHERE ac.admin_id = $1 
          LIMIT 1
        `
      } else if (user.role === "lab_tech") {
        clinicAssociationQuery = `
          SELECT lc.clinic_id, c.name as clinic_name 
          FROM lab_clinics lc 
          JOIN clinics c ON lc.clinic_id = c.id 
          WHERE lc.lab_id = $1 
          LIMIT 1
        `
      }

      if (clinicAssociationQuery) {
        try {
          const clinicRes = await pool.query(clinicAssociationQuery, clinicParams)
          if (clinicRes.rows.length > 0) {
            user.clinic_id = clinicRes.rows[0].clinic_id
            user.clinic_name = clinicRes.rows[0].clinic_name
          }
        } catch (clinicError) {
          logger.warn(`Could not fetch clinic association for user ${id}: ${clinicError.message}`)
          // Continue without clinic association
        }
      }

      // Fetch role-specific portfolio/profile data
      if (user.role === "patient") {
        try {
          const profileTableCheck = await pool.query(
            "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'patient_medical_profiles')",
          )
          if (profileTableCheck.rows[0].exists) {
            const profileResult = await pool.query("SELECT * FROM patient_medical_profiles WHERE patient_id = $1", [
              Number(id),
            ])
            if (profileResult.rows.length) {
              user.profile_details = profileResult.rows[0]
            }
          }
        } catch (profileError) {
          logger.warn(`Could not fetch patient profile for user ${id}: ${profileError.message}`)
        }
      } else if (user.role === "doctor") {
        try {
          const portfolioTableCheck = await pool.query(
            "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'doctor_portfolios')",
          )
          if (portfolioTableCheck.rows[0].exists) {
            const portfolioResult = await pool.query("SELECT * FROM doctor_portfolios WHERE doctor_id = $1", [
              Number(id),
            ])
            if (portfolioResult.rows.length) {
              user.portfolio_details = portfolioResult.rows[0]
              // Prioritize portfolio specialty if available
              if (user.portfolio_details.specialty) user.specialization = user.portfolio_details.specialty
            }
          }
        } catch (portfolioError) {
          logger.warn(`Could not fetch doctor portfolio for user ${id}: ${portfolioError.message}`)
        }
      }

      res.json({ success: true, data: user })
    } catch (err) {
      logger.error(`Get user by ID error: ${err.message}`, { stack: err.stack })
      res.status(500).json({ success: false, error: "Server error", details: err.message })
    }
  }

  /**
   * Creates a new user
   */
  static async createUser(req, res) {
    const {
      email,
      full_name,
      phone,
      role, // e.g., 'clinic_admin', 'doctor'
      password,
      status = "active",
      clinic_id, // ID of the clinic to associate with
      specialization,
      license_number,
      employment_type,
      start_date,
      emergency_contact, // Object: { name, phone, relationship, email }
    } = req.body

    // Validate required fields
    if (!email || !full_name || !role || !password) {
      return res.status(400).json({
        success: false,
        message: "Email, full name, role, and password are required",
      })
    }

    const client = await pool.connect() // Get a client from the pool for transaction

    try {
      await client.query("BEGIN") // Start transaction

      // Check if user already exists
      const existingUser = await client.query("SELECT id FROM users WHERE email = $1", [email])
      if (existingUser.rows.length) {
        await client.query("ROLLBACK")
        return res.status(400).json({ success: false, message: "User with this email already exists" })
      }

      // Get role ID
      const roleResult = await client.query("SELECT id FROM roles WHERE name = $1", [role])
      if (!roleResult.rows.length) {
        await client.query("ROLLBACK")
        return res.status(400).json({ success: false, message: "Invalid role specified." })
      }
      const roleId = roleResult.rows[0].id

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10)

      // Prepare user data for insertion
      const userInsertQuery = `
INSERT INTO users (
  email, full_name, phone, role_id, password_hash, status,
  specialization, license_number, employment_type, start_date, emergency_contact
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
RETURNING id, email, full_name, phone, status, created_at
`
      const userInsertValues = [
        email,
        full_name,
        phone || null,
        roleId,
        hashedPassword,
        status,
        specialization || null,
        license_number || null,
        employment_type || null,
        start_date || null,
        emergency_contact ? JSON.stringify(emergency_contact) : null,
      ]

      const userResult = await client.query(userInsertQuery, userInsertValues)
      const newUser = userResult.rows[0]
      newUser.role = role // Add role name back for the response

      // Handle doctor portfolio creation
      if (role === "doctor") {
        try {
          const portfolioInsertQuery = `
            INSERT INTO doctor_portfolios (
              doctor_id, specialty, license_number, years_experience, 
              consultation_fee, bio, available_for_telemedicine, 
              created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
          `
          const portfolioValues = [
            newUser.id,
            specialization || null,
            license_number || null,
            0, // default years_experience
            150, // default consultation_fee
            null, // default bio
            false, // default available_for_telemedicine
          ]

          await client.query(portfolioInsertQuery, portfolioValues)
          logger.info(`Created doctor portfolio for user ${newUser.id}`)
        } catch (portfolioError) {
          logger.warn(`Could not create doctor portfolio for user ${newUser.id}: ${portfolioError.message}`)
          // Don't fail the user creation if portfolio creation fails
        }
      }

      // Handle clinic association for staff roles
      if (clinic_id) {
        let associationTable = null
        let userIdColumn = null

        if (role === "doctor") {
          associationTable = "doctor_clinics"
          userIdColumn = "doctor_id"
        } else if (role === "nurse") {
          associationTable = "nurse_clinics"
          userIdColumn = "nurse_id"
        } else if (role === "lab_tech") {
          associationTable = "lab_clinics"
          userIdColumn = "lab_id"
        } else if (role === "clinic_admin" || role === "lab_admin") {
          associationTable = "admin_clinics"
          userIdColumn = "admin_id"
        }

        if (associationTable && userIdColumn) {
          const associationQuery = `
    INSERT INTO ${associationTable} (${userIdColumn}, clinic_id)
    VALUES ($1, $2)
    ON CONFLICT (${userIdColumn}, clinic_id) DO NOTHING
  `
          await client.query(associationQuery, [newUser.id, clinic_id])
          logger.info(`Associated user ${newUser.id} (role: ${role}) with clinic ${clinic_id}`)
        }
      }

      await client.query("COMMIT") // Commit transaction

      logger.info(`New user created: ${email} with role: ${role}, ID: ${newUser.id}`)
      res.status(201).json({ success: true, data: newUser })
    } catch (err) {
      await client.query("ROLLBACK") // Rollback transaction on error
      logger.error(`Create user error: ${err.message}`, { stack: err.stack, body: req.body })
      res.status(500).json({ success: false, error: "Server error", details: err.message })
    } finally {
      client.release() // Release client back to the pool
    }
  }

  /**
   * Updates a user (PATCH method for partial updates)
   */
  static async updateUser(req, res) {
    const { id } = req.params
    const { clinic_id, ...updateData } = req.body // Separate clinic_id

    // Validate ID is a number
    if (!id || isNaN(Number(id))) {
      return res.status(400).json({ success: false, message: "Invalid user ID" })
    }

    const client = await pool.connect()

    try {
      await client.query("BEGIN")

      const existingUserResult = await client.query(
        "SELECT id, role_id, (SELECT name FROM roles WHERE id = users.role_id) as current_role FROM users WHERE id = $1",
        [Number(id)],
      )
      if (!existingUserResult.rows.length) {
        await client.query("ROLLBACK")
        return res.status(404).json({ success: false, message: "User not found" })
      }
      const currentUserRole = existingUserResult.rows[0].current_role
      let targetRole = currentUserRole // Role after update

      let roleId = null
      if (updateData.role) {
        const roleResult = await client.query("SELECT id FROM roles WHERE name = $1", [updateData.role])
        if (!roleResult.rows.length) {
          await client.query("ROLLBACK")
          return res.status(400).json({ success: false, message: "Invalid role" })
        }
        roleId = roleResult.rows[0].id
        targetRole = updateData.role // Update targetRole if role is changing
      }

      const updates = []
      const values = []
      let paramCount = 0

      const allowedUserFields = [
        "email",
        "full_name",
        "phone",
        "status",
        "specialization",
        "license_number",
        "employment_type",
        "start_date",
        "emergency_contact",
        "profile_image",
      ]

      allowedUserFields.forEach((field) => {
        if (updateData[field] !== undefined) {
          paramCount++
          updates.push(`${field} = $${paramCount}`)
          values.push(
            field === "emergency_contact" && typeof updateData[field] === "object"
              ? JSON.stringify(updateData[field])
              : updateData[field],
          )
        }
      })

      if (roleId) {
        paramCount++
        updates.push(`role_id = $${paramCount}`)
        values.push(roleId)
      }

      if (updates.length > 0) {
        paramCount++
        updates.push(`updated_at = $${paramCount}`)
        values.push(new Date())

        paramCount++
        values.push(Number(id))

        const query = `
          UPDATE users 
          SET ${updates.join(", ")}
          WHERE id = $${paramCount}
          RETURNING id, email, full_name, phone, status, updated_at,
                    (SELECT name FROM roles WHERE id = users.role_id) as role
        `
        await client.query(query, values)
      }

      // Handle clinic association update
      const staffRolesForClinicAssociation = ["doctor", "nurse", "clinic_admin", "lab_admin", "lab_tech"]
      if (staffRolesForClinicAssociation.includes(targetRole)) {
        let associationTable = null
        let userIdColumn = null
        let oldAssociationTable = null

        // Determine current association based on targetRole
        if (targetRole === "doctor") {
          associationTable = "doctor_clinics"
          userIdColumn = "doctor_id"
        } else if (targetRole === "nurse") {
          associationTable = "nurse_clinics"
          userIdColumn = "nurse_id"
        } else if (targetRole === "clinic_admin" || targetRole === "lab_admin") {
          associationTable = "admin_clinics"
          userIdColumn = "admin_id"
        } else if (targetRole === "lab_tech") {
          associationTable = "lab_clinics"
          userIdColumn = "lab_id"
        }

        // Determine old association if role changed
        if (updateData.role && updateData.role !== currentUserRole) {
          if (currentUserRole === "doctor") {
            oldAssociationTable = "doctor_clinics"
          } else if (currentUserRole === "nurse") {
            oldAssociationTable = "nurse_clinics"
          } else if (currentUserRole === "clinic_admin" || currentUserRole === "lab_admin") {
            oldAssociationTable = "admin_clinics"
          } else if (currentUserRole === "lab_tech") {
            oldAssociationTable = "lab_clinics"
          }
        }

        // If role changed, remove from old association table
        if (oldAssociationTable && oldAssociationTable !== associationTable) {
          try {
            const deleteOldAssociationQuery = `DELETE FROM ${oldAssociationTable} WHERE ${userIdColumn} = $1`
            await client.query(deleteOldAssociationQuery, [Number(id)])
            logger.info(
              `Removed user ${id} from old clinic association table ${oldAssociationTable} due to role change.`,
            )
          } catch (deleteError) {
            logger.warn(`Could not remove old clinic association: ${deleteError.message}`)
          }
        }

        if (associationTable && userIdColumn) {
          // Remove existing associations for this user in this table
          try {
            const deleteQuery = `DELETE FROM ${associationTable} WHERE ${userIdColumn} = $1`
            await client.query(deleteQuery, [Number(id)])

            if (clinic_id !== undefined && clinic_id !== null && clinic_id !== "none") {
              const numericClinicId = Number(clinic_id)
              if (!isNaN(numericClinicId)) {
                const insertQuery = `
                  INSERT INTO ${associationTable} (${userIdColumn}, clinic_id) 
                  VALUES ($1, $2)
                  ON CONFLICT (${userIdColumn}, clinic_id) DO NOTHING
                `
                await client.query(insertQuery, [Number(id), numericClinicId])
                logger.info(
                  `Updated clinic association for user ${id} (role: ${targetRole}) to clinic ${numericClinicId}`,
                )
              }
            } else {
              logger.info(`User ${id} (role: ${targetRole}) is not associated with any clinic or clinic_id was 'none'.`)
            }
          } catch (associationError) {
            logger.warn(`Could not update clinic association: ${associationError.message}`)
          }
        }
      }

      await client.query("COMMIT")

      // Fetch the updated user again to return complete data
      const updatedUserResult = await client.query(
        `SELECT u.*, r.name as role 
         FROM users u 
         LEFT JOIN roles r ON u.role_id = r.id 
         WHERE u.id = $1`,
        [Number(id)],
      )
      const finalUpdatedUser = updatedUserResult.rows[0]
      if (finalUpdatedUser.emergency_contact && typeof finalUpdatedUser.emergency_contact === "string") {
        try {
          finalUpdatedUser.emergency_contact = JSON.parse(finalUpdatedUser.emergency_contact)
        } catch (e) {
          logger.warn(`Could not parse emergency_contact JSON for user ${id}`)
        }
      }

      logger.info(`User updated: ${id}`)
      res.json({ success: true, data: finalUpdatedUser, message: "User updated successfully" })
    } catch (err) {
      await client.query("ROLLBACK")
      logger.error(`Update user error: ${err.message}`, { stack: err.stack, body: req.body })
      res.status(500).json({ success: false, error: "Server error", details: err.message })
    } finally {
      client.release()
    }
  }

  /**
   * Deletes a user
   */
  static async deleteUser(req, res) {
    try {
      const { id } = req.params

      // Validate ID is a number
      if (!id || isNaN(Number(id))) {
        return res.status(400).json({ success: false, message: "Invalid user ID" })
      }

      // Check if user exists
      const existingUser = await pool.query("SELECT id, email FROM users WHERE id = $1", [Number(id)])
      if (!existingUser.rows.length) {
        return res.status(404).json({ success: false, message: "User not found" })
      }

      // Delete user (this should cascade to related tables)
      await pool.query("DELETE FROM users WHERE id = $1", [Number(id)])

      logger.info(`User deleted: ${existingUser.rows[0].email}`)
      res.json({ success: true, message: "User deleted successfully" })
    } catch (err) {
      logger.error(`Delete user error: ${err.message}`)
      res.status(500).json({ success: false, error: "Server error", details: err.message })
    }
  }

  /**
   * Gets the current user's profile
   */
  static async getProfile(req, res) {
    try {
      // Get basic user info
      const userResult = await pool.query(
        "SELECT u.id, u.email, u.full_name, u.phone, r.name AS role FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = $1",
        [req.user.id],
      )

      if (!userResult.rows.length) {
        return res.status(404).json({ error: "User not found" })
      }

      const user = userResult.rows[0]

      // Add role-specific profile data
      if (user.role === "patient") {
        // Check if patient_medical_profiles exists
        const profileTableCheck = await pool.query(
          "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'patient_medical_profiles')",
        )

        if (profileTableCheck.rows[0].exists) {
          const profileResult = await pool.query("SELECT * FROM patient_medical_profiles WHERE patient_id = $1", [
            req.user.id,
          ])

          if (profileResult.rows.length) {
            user.profile = profileResult.rows[0]
          }
        }
      } else if (user.role === "doctor") {
        // Check if doctor_portfolios exists
        const portfolioTableCheck = await pool.query(
          "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'doctor_portfolios')",
        )

        if (portfolioTableCheck.rows[0].exists) {
          const profileResult = await pool.query("SELECT * FROM doctor_portfolios WHERE doctor_id = $1", [req.user.id])

          if (profileResult.rows.length) {
            user.profile = profileResult.rows[0]
          }
        }

        // Check if doctor_clinics exists
        const clinicsTableCheck = await pool.query(
          "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'doctor_clinics')",
        )

        if (clinicsTableCheck.rows[0].exists) {
          const clinicsResult = await pool.query(
            "SELECT c.id, c.name FROM clinics c JOIN doctor_clinics dc ON c.id = dc.clinic_id WHERE dc.doctor_id = $1",
            [req.user.id],
          )

          user.clinics = clinicsResult.rows
        } else {
          user.clinics = []
        }
      }

      res.json(user)
    } catch (err) {
      logger.error(`Get profile error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  /**
   * Updates the current user's profile
   */
  static async updateProfile(req, res) {
    const { name, email, phone } = req.body

    try {
      // Use transaction for data integrity
      await pool.query("BEGIN")

      // Update user info
      const userResult = await pool.query(
        "UPDATE users SET full_name = COALESCE($1, full_name), email = COALESCE($2, email), phone = COALESCE($3, phone) WHERE id = $4 RETURNING id, email, full_name, phone, (SELECT name FROM roles WHERE id = users.role_id) AS role",
        [name, email, phone, req.user.id],
      )

      if (!userResult.rows.length) {
        await pool.query("ROLLBACK")
        return res.status(404).json({ error: "User not found" })
      }

      const user = userResult.rows[0]

      await pool.query("COMMIT")

      logger.info(`Profile updated for user: ${req.user.id}`)
      res.json({ message: "Profile updated", user })
    } catch (err) {
      await pool.query("ROLLBACK")
      logger.error(`Update profile error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }
}

module.exports = UserController
