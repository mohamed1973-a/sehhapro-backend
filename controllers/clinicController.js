/**
 * Clinic Controller
 *
 * Manages clinic operations including creation, updates, and associations.
 */
const { pool } = require("../config/database")
const logger = require("../middleware/logger")
const asyncHandler = require("../utils/asyncHandler")

class ClinicController {
  /**
   * Gets all public clinics (no authentication required)
   * This is for patients and public users to see available clinics
   */
  static async getPublicClinics(req, res) {
    try {
      console.log("[ClinicController] Getting public clinics")

      const query = `
        SELECT 
          id,
          name,
          address,
          phone,
          email,
          description,
          type,
          created_at,
          updated_at
        FROM clinics 
        WHERE type IN ('parent', 'main', 'child')
        ORDER BY name
      `

      const result = await pool.query(query)

      console.log(`[ClinicController] Found ${result.rows.length} public clinics`)

      res.status(200).json({
        success: true,
        data: result.rows,
        message: `Found ${result.rows.length} clinics`,
      })
    } catch (err) {
      console.error("[ClinicController] Get public clinics error:", err)
      logger.error(`Get public clinics error: ${err.message}`)
      res.status(500).json({
        success: false,
        error: "Server error",
        details: err.message,
      })
    }
  }

  /**
   * Creates a new clinic
   */
  static async createClinic(req, res) {
    const { name, address, phone, email, description, type = "parent", parentId } = req.body
    console.log("Creating clinic with parentId:", parentId)

    try {
      // Validate required fields
      if (!name) {
        return res.status(400).json({ error: "Clinic name is required" })
      }

      // Validate clinic type
      if (!["parent", "child", "main", "lab"].includes(type)) {
        return res.status(400).json({ error: "Invalid clinic type; must be 'parent', 'main', 'child', or 'lab'" })
      }

      // Check user role and permissions
      if (req.user.role === "platform_admin") {
        // Platform admin can create any type of clinic
      } else if (req.user.role === "clinic_admin") {
        // Clinic admin can only create child clinics or labs
        if (type !== "child" && type !== "lab") {
          return res.status(403).json({ error: "Clinic admin can only create child clinics or labs" })
        }

        // Verify the parent clinic is associated with this admin
        if (parentId) {
          const adminClinicCheck = await pool.query(
            "SELECT 1 FROM admin_clinics WHERE admin_id = $1 AND clinic_id = $2 AND is_primary = TRUE",
            [req.user.id, parentId],
          )
          if (adminClinicCheck.rows.length === 0) {
            return res.status(403).json({ error: "You can only create child clinics for your primary clinic" })
          }
        } else {
          // If no parentId provided, get the admin's primary clinic
          const primaryClinicResult = await pool.query(
            "SELECT clinic_id FROM admin_clinics WHERE admin_id = $1 AND is_primary = TRUE",
            [req.user.id],
          )
          if (primaryClinicResult.rows.length === 0) {
            return res.status(400).json({ error: "No primary clinic found for this admin" })
          }
          const parentId = primaryClinicResult.rows[0].clinic_id
        }
      } else if (req.user.role === "lab_admin") {
        return res.status(403).json({ error: "Lab admin cannot create clinics" })
      }

      // Verify parent clinic exists if type is "child" or "lab"
      if ((type === "child" || type === "lab") && parentId) {
        const parentCheck = await pool.query("SELECT 1 FROM clinics WHERE id = $1", [parentId])
        if (parentCheck.rows.length === 0) {
          return res.status(400).json({ error: "Parent clinic not found" })
        }
      }

      // Convert parentId to integer if provided
      let parsedParentId = null
      if (parentId) {
        parsedParentId = Number.parseInt(parentId, 10)
      }

      // Create the clinic
      const result = await pool.query(
        "INSERT INTO clinics (name, address, phone, email, description, type, parent_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
        [name, address, phone, email, description, type, parsedParentId],
      )

      const clinic = result.rows[0]

      // If clinic admin is creating a child clinic, associate them with it
      if (req.user.role === "clinic_admin" && (type === "child" || type === "lab")) {
        await pool.query("INSERT INTO admin_clinics (admin_id, clinic_id, is_primary) VALUES ($1, $2, $3)", [
          req.user.id,
          clinic.id,
          false,
        ])
      }

      logger.info(`Clinic created: ${name} (type: ${type})`)
      res.status(201).json({
        message: "Clinic created successfully",
        clinic: clinic,
      })
    } catch (err) {
      logger.error(`Create clinic error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  /**
   * Gets all clinics with optional filtering
   */
  static async getAllClinics(req, res) {
    const { search, type } = req.query

    try {
      // Build query with optional filters
      let query = "SELECT * FROM clinics"
      const params = []
      const conditions = []

      // Role-based filtering
      if (req.user.role === "platform_admin") {
        // Platform admin can see all clinics
      } else if (req.user.role === "clinic_admin") {
        // Clinic admin can see their primary clinic and its child clinics
        conditions.push(`(id IN (SELECT clinic_id FROM admin_clinics WHERE admin_id = $${params.length + 1}) OR 
                         parent_id IN (SELECT clinic_id FROM admin_clinics WHERE admin_id = $${params.length + 1} AND is_primary = TRUE))`)
        params.push(req.user.id)
      } else if (req.user.role === "lab_admin") {
        // Lab admin can only see their assigned lab and its parent
        conditions.push(`(id IN (SELECT clinic_id FROM admin_clinics WHERE admin_id = $${params.length + 1}) OR 
                   id IN (SELECT parent_id FROM clinics WHERE id IN 
                         (SELECT clinic_id FROM admin_clinics WHERE admin_id = $${params.length + 1})))`)
        params.push(req.user.id)
      } else if (req.user.role === "doctor" || req.user.role === "lab") {
        // Doctors and lab techs can see clinics they're associated with
        conditions.push(`id IN (SELECT clinic_id FROM doctor_clinics WHERE doctor_id = $${params.length + 1})`)
        params.push(req.user.id)
      } else if (req.user.role === "patient") {
        // Patients can see all public clinics
        conditions.push(`type IN ('parent', 'main', 'child')`)
      }

      if (search) {
        conditions.push(`(name ILIKE $${params.length + 1} OR address ILIKE $${params.length + 1})`)
        params.push(`%${search}%`)
      }

      if (type) {
        conditions.push(`type = $${params.length + 1}`)
        params.push(type)
      }

      if (conditions.length > 0) {
        query += " WHERE " + conditions.join(" AND ")
      }

      query += " ORDER BY name"

      // Execute query
      const result = await pool.query(query, params)
      res.status(200).json({
        success: true,
        data: result.rows,
      })
    } catch (err) {
      logger.error(`Get all clinics error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  /**
   * Gets detailed information for a specific clinic
   */
  static async getClinic(req, res) {
    const { id } = req.params

    try {
      // Get clinic details
      const clinicResult = await pool.query("SELECT * FROM clinics WHERE id = $1", [id])
      if (!clinicResult.rows.length) {
        return res.status(404).json({ error: "Clinic not found" })
      }

      const clinic = clinicResult.rows[0]

      // Check permissions based on role
      if (req.user.role === "platform_admin") {
        // Platform admin can access any clinic
      } else if (req.user.role === "clinic_admin") {
        // Check if clinic admin is associated with this clinic or it's a child of their primary clinic
        const adminClinicCheck = await pool.query(
          `SELECT 1 FROM admin_clinics ac 
           WHERE ac.admin_id = $1 AND 
           (ac.clinic_id = $2 OR 
            $2 IN (SELECT c.id FROM clinics c WHERE c.parent_id IN 
                  (SELECT ac2.clinic_id FROM admin_clinics ac2 WHERE ac2.admin_id = $1 AND ac2.is_primary = TRUE)))`,
          [req.user.id, id],
        )
        if (adminClinicCheck.rows.length === 0) {
          return res.status(403).json({ error: "Not authorized to access this clinic" })
        }
      } else if (req.user.role === "lab_admin") {
        // Lab admin can only access their assigned lab
        const adminClinicCheck = await pool.query(
          "SELECT 1 FROM admin_clinics WHERE admin_id = $1 AND clinic_id = $2",
          [req.user.id, id],
        )
        if (adminClinicCheck.rows.length === 0) {
          return res.status(403).json({ error: "Not authorized to access this clinic" })
        }
      } else if (req.user.role === "patient") {
        // Patients can view any public clinic
        if (!["parent", "main", "child"].includes(clinic.type)) {
          return res.status(403).json({ error: "Not authorized to access this clinic" })
        }
      } else {
        // Other roles need to be associated with the clinic
        let associationCheck
        if (req.user.role === "doctor" || req.user.role === "lab") {
          associationCheck = await pool.query("SELECT 1 FROM doctor_clinics WHERE doctor_id = $1 AND clinic_id = $2", [
            req.user.id,
            id,
          ])
        }

        if (!associationCheck || associationCheck.rows.length === 0) {
          return res.status(403).json({ error: "Not authorized to access this clinic" })
        }
      }

      // Check if association tables exist
      const doctorClinicsCheck = await pool.query(
        "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'doctor_clinics')",
      )
      const labClinicsCheck = await pool.query(
        "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'lab_clinics')",
      )
      const patientClinicsCheck = await pool.query(
        "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'patient_clinics')",
      )
      const adminClinicsCheck = await pool.query(
        "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'admin_clinics')",
      )

      // Initialize association arrays
      let doctors = []
      let labs = []
      let patients = []
      let admins = []
      let childClinics = []

      // Get associated doctors if table exists
      if (doctorClinicsCheck.rows[0].exists) {
        const doctorsResult = await pool.query(
          "SELECT u.id, u.full_name, u.email FROM users u JOIN doctor_clinics dc ON u.id = dc.doctor_id WHERE dc.clinic_id = $1",
          [id],
        )
        doctors = doctorsResult.rows
      }

      // Get associated labs if table exists
      if (labClinicsCheck.rows[0].exists) {
        const labsResult = await pool.query(
          "SELECT u.id, u.full_name, u.email FROM users u JOIN lab_clinics lc ON u.id = lc.lab_id WHERE lc.clinic_id = $1",
          [id],
        )
        labs = labsResult.rows
      }

      // Get associated patients if table exists
      if (patientClinicsCheck.rows[0].exists) {
        const patientsResult = await pool.query(
          "SELECT u.id, u.full_name, u.email, pc.is_primary FROM users u JOIN patient_clinics pc ON u.id = pc.patient_id WHERE pc.clinic_id = $1",
          [id],
        )
        patients = patientsResult.rows
      }

      // Get associated admins if table exists
      if (adminClinicsCheck.rows[0].exists) {
        const adminsResult = await pool.query(
          "SELECT u.id, u.full_name, u.email, r.name AS role, ac.is_primary FROM users u JOIN admin_clinics ac ON u.id = ac.admin_id JOIN roles r ON u.role_id = r.id WHERE ac.clinic_id = $1",
          [id],
        )
        admins = adminsResult.rows
      }

      // Get child clinics
      const childClinicsResult = await pool.query(
        "SELECT id, name, type, address, phone, email FROM clinics WHERE parent_id = $1",
        [id],
      )
      childClinics = childClinicsResult.rows

      // Add associations to clinic object
      clinic.doctors = doctors
      clinic.labs = labs
      clinic.patients = patients
      clinic.admins = admins
      clinic.childClinics = childClinics

      res.status(200).json({
        success: true,
        data: clinic,
      })
    } catch (err) {
      logger.error(`Get clinic error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  /**
   * Gets all staff members for a specific clinic
   */
  static async getClinicStaff(req, res) {
    const { id } = req.params

    try {
      console.log(`[ClinicController] Getting staff for clinic ${id}`)

      // Check if clinic exists
      const clinicResult = await pool.query("SELECT * FROM clinics WHERE id = $1", [id])
      if (!clinicResult.rows.length) {
        return res.status(404).json({ error: "Clinic not found" })
      }

      // Check permissions based on role
      if (req.user.role === "platform_admin") {
        // Platform admin can access any clinic staff
      } else if (req.user.role === "clinic_admin") {
        // Check if clinic admin is associated with this clinic
        const adminClinicCheck = await pool.query(
          `SELECT 1 FROM admin_clinics ac 
           WHERE ac.admin_id = $1 AND 
           (ac.clinic_id = $2 OR 
            $2 IN (SELECT c.id FROM clinics c WHERE c.parent_id IN 
                  (SELECT ac2.clinic_id FROM admin_clinics ac2 WHERE ac2.admin_id = $1 AND ac2.is_primary = TRUE)))`,
          [req.user.id, id],
        )
        if (adminClinicCheck.rows.length === 0) {
          return res.status(403).json({ error: "Not authorized to access this clinic staff" })
        }
      } else if (req.user.role === "lab_admin") {
        // Lab admin can only access their assigned lab staff
        const adminClinicCheck = await pool.query(
          "SELECT 1 FROM admin_clinics WHERE admin_id = $1 AND clinic_id = $2",
          [req.user.id, id],
        )
        if (adminClinicCheck.rows.length === 0) {
          return res.status(403).json({ error: "Not authorized to access this clinic staff" })
        }
      } else {
        return res.status(403).json({ error: "Not authorized to access clinic staff" })
      }

      // Get all staff members for this clinic using a simpler approach
      const staffMembers = []

      // Check which association tables exist and get staff from each
      const associationTables = [
        { table: "doctor_clinics", idCol: "doctor_id", role: "doctor" },
        { table: "nurse_clinics", idCol: "nurse_id", role: "nurse" },
        { table: "lab_clinics", idCol: "lab_id", role: "lab_tech" },
        { table: "admin_clinics", idCol: "admin_id", role: "admin" },
      ]

      for (const tableInfo of associationTables) {
        try {
          // Check if table exists
          const tableCheck = await pool.query(
            `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)`,
            [tableInfo.table],
          )

          if (tableCheck.rows[0].exists) {
            console.log(`[ClinicController] Checking ${tableInfo.table} for clinic ${id}`)

            // Get staff from this association table
            const staffQuery = `
              SELECT 
                u.id,
                u.full_name,
                u.email,
                u.phone,
                u.status,
                u.profile_image,
                u.created_at as joined_date,
                COALESCE(assoc.is_primary, false) as is_primary,
                $3 as role,
                u.specialization as specialization_or_department
              FROM users u
              JOIN ${tableInfo.table} assoc ON u.id = assoc.${tableInfo.idCol}
              WHERE assoc.clinic_id = $1
              ORDER BY u.full_name
            `

            const result = await pool.query(staffQuery, [id, tableInfo.table, tableInfo.role])
            console.log(`[ClinicController] Found ${result.rows.length} ${tableInfo.role}s`)

            staffMembers.push(...result.rows)
          } else {
            console.log(`[ClinicController] Table ${tableInfo.table} does not exist`)
          }
        } catch (tableError) {
          console.log(`[ClinicController] Error checking table ${tableInfo.table}:`, tableError.message)
          // Continue with other tables
        }
      }

      console.log(`[ClinicController] Total staff found: ${staffMembers.length}`)

      res.status(200).json({
        success: true,
        staff: staffMembers,
        message: staffMembers.length > 0 ? "Staff retrieved successfully" : "No staff found for this clinic",
      })
    } catch (err) {
      console.error(`[ClinicController] Get clinic staff error:`, err)
      logger.error(`Get clinic staff error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  /**
   * Removes a staff member from a clinic
   */
  static async removeStaffMember(req, res) {
    const { clinicId, staffId } = req.params

    try {
      // Check permissions
      if (req.user.role === "platform_admin") {
        // Platform admin can remove any staff
      } else if (req.user.role === "clinic_admin") {
        // Check if clinic admin is associated with this clinic
        const adminClinicCheck = await pool.query(
          `SELECT 1 FROM admin_clinics ac 
           WHERE ac.admin_id = $1 AND 
           (ac.clinic_id = $2 OR 
            $2 IN (SELECT c.id FROM clinics c WHERE c.parent_id IN 
                  (SELECT ac2.clinic_id FROM admin_clinics ac2 WHERE ac2.admin_id = $1 AND ac2.is_primary = TRUE)))`,
          [req.user.id, clinicId],
        )
        if (adminClinicCheck.rows.length === 0) {
          return res.status(403).json({ error: "Not authorized to remove staff from this clinic" })
        }
      } else {
        return res.status(403).json({ error: "Not authorized to remove staff" })
      }

      // Get user role to determine which table to remove from
      const userResult = await pool.query(
        "SELECT u.id, r.name as role FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = $1",
        [staffId],
      )

      if (!userResult.rows.length) {
        return res.status(404).json({ error: "Staff member not found" })
      }

      const userRole = userResult.rows[0].role
      let tableName = ""
      let idColumn = ""

      // Determine which association table to remove from
      switch (userRole) {
        case "doctor":
          tableName = "doctor_clinics"
          idColumn = "doctor_id"
          break
        case "nurse":
          tableName = "nurse_clinics"
          idColumn = "nurse_id"
          break
        case "lab":
        case "lab_tech":
          tableName = "lab_clinics"
          idColumn = "lab_id"
          break
        case "clinic_admin":
        case "lab_admin":
          tableName = "admin_clinics"
          idColumn = "admin_id"
          break
        default:
          return res.status(400).json({ error: "Invalid staff role" })
      }

      // Remove the association
      const deleteResult = await pool.query(
        `DELETE FROM ${tableName} WHERE ${idColumn} = $1 AND clinic_id = $2 RETURNING *`,
        [staffId, clinicId],
      )

      if (!deleteResult.rows.length) {
        return res.status(404).json({ error: "Staff member not associated with this clinic" })
      }

      logger.info(`Staff member ${staffId} removed from clinic ${clinicId}`)
      res.status(200).json({
        success: true,
        message: "Staff member removed successfully",
      })
    } catch (err) {
      logger.error(`Remove staff member error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  /**
   * Updates clinic information
   */
  static async updateClinic(req, res) {
    const { id } = req.params
    const { name, address, phone, email, description, type, parent_id } = req.body

    try {
      // Get clinic details
      const clinicResult = await pool.query("SELECT * FROM clinics WHERE id = $1", [id])
      if (!clinicResult.rows.length) {
        return res.status(404).json({ error: "Clinic not found" })
      }

      const clinic = clinicResult.rows[0]

      // Check permissions based on role
      if (req.user.role === "platform_admin") {
        // Platform admin can update any clinic
      } else if (req.user.role === "clinic_admin") {
        // Check if clinic admin is associated with this clinic or it's a child of their primary clinic
        const adminClinicCheck = await pool.query(
          `SELECT 1 FROM admin_clinics ac 
           WHERE ac.admin_id = $1 AND 
           (ac.clinic_id = $2 OR 
            $2 IN (SELECT c.id FROM clinics c WHERE c.parent_id IN 
                  (SELECT ac2.clinic_id FROM admin_clinics ac2 WHERE ac2.admin_id = $1 AND ac2.is_primary = TRUE)))`,
          [req.user.id, id],
        )
        if (adminClinicCheck.rows.length === 0) {
          return res.status(403).json({ error: "Not authorized to update this clinic" })
        }

        // Clinic admin cannot change the type of their primary clinic
        if (type && type !== clinic.type) {
          const isPrimaryClinic = await pool.query(
            "SELECT 1 FROM admin_clinics WHERE admin_id = $1 AND clinic_id = $2 AND is_primary = TRUE",
            [req.user.id, id],
          )
          if (isPrimaryClinic.rows.length > 0) {
            return res.status(403).json({ error: "Cannot change the type of your primary clinic" })
          }
        }
      } else if (req.user.role === "lab_admin") {
        // Lab admin can only update their assigned lab's basic info
        const adminClinicCheck = await pool.query(
          "SELECT 1 FROM admin_clinics WHERE admin_id = $1 AND clinic_id = $2",
          [req.user.id, id],
        )
        if (adminClinicCheck.rows.length === 0) {
          return res.status(403).json({ error: "Not authorized to update this clinic" })
        }

        // Lab admin cannot change the type or parent_id
        if (type || parent_id) {
          return res.status(403).json({ error: "Lab admin cannot change clinic type or parent relationship" })
        }
      } else {
        return res.status(403).json({ error: "Not authorized to update clinics" })
      }

      // Validate clinic type if provided
      if (type && !["parent", "child", "main", "lab"].includes(type)) {
        return res.status(400).json({ error: "Invalid clinic type; must be 'parent', 'main', 'child', or 'lab'" })
      }

      // Verify parent clinic exists if provided
      if (parent_id) {
        const parentCheck = await pool.query("SELECT 1 FROM clinics WHERE id = $1", [parent_id])
        if (parentCheck.rows.length === 0) {
          return res.status(400).json({ error: "Parent clinic not found" })
        }
      }

      // Prevent circular references
      if (parent_id && Number(parent_id) === Number(id)) {
        return res.status(400).json({ error: "A clinic cannot be its own parent" })
      }

      // Check for deeper circular references
      if (parent_id) {
        let currentParentId = Number(parent_id)
        const visitedIds = new Set()

        while (currentParentId) {
          // If we've seen this ID before, we have a cycle
          if (visitedIds.has(currentParentId)) {
            return res.status(400).json({ error: "Circular reference detected in clinic hierarchy" })
          }

          visitedIds.add(currentParentId)

          // Get the parent's parent
          const parentResult = await pool.query("SELECT parent_id FROM clinics WHERE id = $1", [currentParentId])

          if (parentResult.rows.length === 0 || !parentResult.rows[0].parent_id) {
            break
          }

          currentParentId = parentResult.rows[0].parent_id

          // If this would create a cycle, reject it
          if (currentParentId === Number(id)) {
            return res.status(400).json({ error: "Circular reference detected in clinic hierarchy" })
          }
        }
      }

      // Convert parent_id to integer if provided
      let parsedParentId = null
      if (parent_id) {
        parsedParentId = Number.parseInt(parent_id, 10)
      }

      // Update clinic
      const result = await pool.query(
        "UPDATE clinics SET name = COALESCE($1, name), address = COALESCE($2, address), phone = COALESCE($3, phone), email = COALESCE($4, email), description = COALESCE($5, description), type = COALESCE($6, type), parent_id = COALESCE($7, parent_id), updated_at = NOW() WHERE id = $8 RETURNING *",
        [name, address, phone, email, description, type, parsedParentId, id],
      )

      if (!result.rows.length) {
        return res.status(404).json({ error: "Clinic not found" })
      }

      logger.info(`Clinic updated: ${id}`)
      res.status(200).json({
        message: "Clinic updated successfully",
        clinic: result.rows[0],
      })
    } catch (err) {
      logger.error(`Update clinic error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  /**
   * Deletes a clinic if it has no child clinics
   */
  static async deleteClinic(req, res) {
    const { id } = req.params
    const { deleteChildren = false } = req.query

    try {
      // Get clinic details
      const clinicResult = await pool.query("SELECT * FROM clinics WHERE id = $1", [id])
      if (!clinicResult.rows.length) {
        return res.status(404).json({ error: "Clinic not found" })
      }

      const clinic = clinicResult.rows[0]

      // Check permissions based on role
      if (req.user.role === "platform_admin") {
        // Platform admin can delete any clinic
      } else if (req.user.role === "clinic_admin") {
        // Clinic admin can only delete child clinics of their primary clinic
        if (clinic.type !== "child" && clinic.type !== "lab") {
          return res.status(403).json({ error: "Clinic admin can only delete child clinics or labs" })
        }

        const adminPrimaryClinicCheck = await pool.query(
          "SELECT clinic_id FROM admin_clinics WHERE admin_id = $1 AND is_primary = TRUE",
          [req.user.id],
        )

        if (adminPrimaryClinicCheck.rows.length === 0) {
          return res.status(403).json({ error: "No primary clinic found for this admin" })
        }

        const primaryClinicId = adminPrimaryClinicCheck.rows[0].clinic_id

        if (clinic.parent_id !== primaryClinicId) {
          return res.status(403).json({ error: "Not authorized to delete this clinic" })
        }
      } else if (req.user.role === "lab_admin") {
        return res.status(403).json({ error: "Lab admin cannot delete clinics" })
      } else {
        return res.status(403).json({ error: "Not authorized to delete clinics" })
      }

      // Check for child clinics
      const childClinicsCheck = await pool.query("SELECT id FROM clinics WHERE parent_id = $1", [id])

      if (childClinicsCheck.rows.length > 0 && !deleteChildren) {
        return res.status(400).json({
          error: "Cannot delete clinic with child clinics",
          message: "Please delete or reassign all child clinics first, or use ?deleteChildren=true parameter",
          childClinics: childClinicsCheck.rows,
        })
      }

      await pool.query("BEGIN")

      // Delete child clinics if requested
      if (deleteChildren && childClinicsCheck.rows.length > 0) {
        logger.info(`Deleting ${childClinicsCheck.rows.length} child clinics of clinic ${id}`)

        for (const childClinic of childClinicsCheck.rows) {
          // Remove associations for child clinics
          await pool.query("DELETE FROM doctor_clinics WHERE clinic_id = $1", [childClinic.id])
          await pool.query("DELETE FROM lab_clinics WHERE clinic_id = $1", [childClinic.id])
          await pool.query("DELETE FROM patient_clinics WHERE clinic_id = $1", [childClinic.id])
          await pool.query("DELETE FROM admin_clinics WHERE clinic_id = $1", [childClinic.id])
          await pool.query("UPDATE appointments SET status = 'cancelled' WHERE clinic_id = $1", [childClinic.id])

          // Delete the child clinic
          await pool.query("DELETE FROM clinics WHERE id = $1", [childClinic.id])
        }
      }

      // Check if association tables exist
      const doctorClinicsCheck = await pool.query(
        "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'doctor_clinics')",
      )
      const labClinicsCheck = await pool.query(
        "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'lab_clinics')",
      )
      const patientClinicsCheck = await pool.query(
        "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'patient_clinics')",
      )
      const adminClinicsCheck = await pool.query(
        "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'admin_clinics')",
      )
      const appointmentsCheck = await pool.query(
        "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'appointments')",
      )

      // Delete associations if tables exist
      if (doctorClinicsCheck.rows[0].exists) {
        await pool.query("DELETE FROM doctor_clinics WHERE clinic_id = $1", [id])
      }

      if (labClinicsCheck.rows[0].exists) {
        await pool.query("DELETE FROM lab_clinics WHERE clinic_id = $1", [id])
      }

      if (patientClinicsCheck.rows[0].exists) {
        await pool.query("DELETE FROM patient_clinics WHERE clinic_id = $1", [id])
      }

      if (adminClinicsCheck.rows[0].exists) {
        await pool.query("DELETE FROM admin_clinics WHERE clinic_id = $1", [id])
      }

      if (appointmentsCheck.rows[0].exists) {
        await pool.query("UPDATE appointments SET status = 'cancelled' WHERE clinic_id = $1", [id])
      }

      // Check if nurse_clinics table exists
      const nurseClinicsCheck = await pool.query(
        "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'nurse_clinics')",
      )

      if (nurseClinicsCheck.rows[0].exists) {
        await pool.query("DELETE FROM nurse_clinics WHERE clinic_id = $1", [id])
      }

      // Check if availability_slots table exists
      const availabilitySlotsCheck = await pool.query(
        "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'availability_slots')",
      )

      if (availabilitySlotsCheck.rows[0].exists) {
        await pool.query("DELETE FROM availability_slots WHERE clinic_id = $1", [id])
      }

      // Delete the clinic
      const result = await pool.query("DELETE FROM clinics WHERE id = $1 RETURNING id", [id])
      if (!result.rows.length) {
        await pool.query("ROLLBACK")
        return res.status(404).json({ error: "Clinic not found" })
      }

      await pool.query("COMMIT")

      logger.info(`Clinic deleted: ${id}`)
      res.status(200).json({
        message:
          deleteChildren && childClinicsCheck.rows.length > 0
            ? `Clinic deleted successfully along with ${childClinicsCheck.rows.length} child clinics`
            : "Clinic deleted successfully",
      })
    } catch (err) {
      await pool.query("ROLLBACK")
      logger.error(`Delete clinic error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  /**
   * Generic method to associate a user with a clinic
   * Reduces code duplication across different user types
   */
  static async associateUserWithClinic(req, res, userType) {
    const { clinicId } = req.params
    const userId = req.body[`${userType}Id`]
    const isPrimary = req.body.isPrimary || false

    // Configuration for different user types
    const config = {
      doctor: {
        roleName: "doctor",
        tableName: "doctor_clinics",
        idColumn: "doctor_id",
        errorMsg: "Invalid doctor ID",
      },
      nurse: {
        roleName: "nurse",
        tableName: "nurse_clinics",
        idColumn: "nurse_id",
        errorMsg: "Invalid nurse ID",
      },
      lab: {
        roleName: "lab",
        tableName: "lab_clinics",
        idColumn: "lab_id",
        errorMsg: "Invalid lab ID",
      },
      patient: {
        roleName: "patient",
        tableName: "patient_clinics",
        idColumn: "patient_id",
        errorMsg: "Invalid patient ID",
        hasPrimary: true,
      },
      admin: {
        roleName: ["clinic_admin", "lab_admin"],
        tableName: "admin_clinics",
        idColumn: "admin_id",
        errorMsg: "Invalid admin ID",
        hasPrimary: true,
      },
    }

    const typeConfig = config[userType]
    if (!typeConfig) {
      return res.status(400).json({ error: `Invalid user type: ${userType}` })
    }

    try {
      // Verify user exists with correct role
      let roleCheck
      if (Array.isArray(typeConfig.roleName)) {
        roleCheck = await pool.query(
          `SELECT 1 FROM users u JOIN roles r ON u.role_id = r.id 
           WHERE u.id = $1 AND r.name = ANY($2)`,
          [userId, typeConfig.roleName],
        )
      } else {
        roleCheck = await pool.query(
          `SELECT 1 FROM users u JOIN roles r ON u.role_id = r.id 
           WHERE u.id = $1 AND r.name = $2`,
          [userId, typeConfig.roleName],
        )
      }

      if (!roleCheck.rows.length) {
        return res.status(400).json({ error: typeConfig.errorMsg })
      }

      // Verify clinic exists
      const clinicCheck = await pool.query("SELECT * FROM clinics WHERE id = $1", [clinicId])
      if (!clinicCheck.rows.length) {
        return res.status(404).json({ error: "Clinic not found" })
      }

      // Check permissions based on role
      if (req.user.role === "platform_admin") {
        // Platform admin can add any user to any clinic
      } else if (req.user.role === "clinic_admin") {
        // Check if clinic admin is associated with this clinic or it's a child of their primary clinic
        const adminClinicCheck = await pool.query(
          `SELECT 1 FROM admin_clinics ac 
           WHERE ac.admin_id = $1 AND 
           (ac.clinic_id = $2 OR 
            $2 IN (SELECT c.id FROM clinics c WHERE c.parent_id IN 
                  (SELECT ac2.clinic_id FROM admin_clinics ac2 WHERE ac2.admin_id = $1 AND ac2.is_primary = TRUE)))`,
          [req.user.id, clinicId],
        )
        if (adminClinicCheck.rows.length === 0) {
          return res.status(403).json({ error: `Not authorized to add ${userType}s to this clinic` })
        }
      } else if (req.user.role === "lab_admin") {
        // Lab admin can only add users to their assigned lab
        const adminClinicCheck = await pool.query(
          "SELECT 1 FROM admin_clinics WHERE admin_id = $1 AND clinic_id = $2",
          [req.user.id, clinicId],
        )
        if (adminClinicCheck.rows.length === 0) {
          return res.status(403).json({ error: `Not authorized to add ${userType}s to this clinic` })
        }
      } else {
        return res.status(403).json({ error: `Not authorized to add ${userType}s to clinics` })
      }

      // Check if association table exists, create if not
      const tableCheck = await pool.query(
        `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)`,
        [typeConfig.tableName],
      )

      if (!tableCheck.rows[0].exists) {
        // Create the association table if it doesn't exist
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

      // Add user to clinic
      let result
      if (typeConfig.hasPrimary) {
        result = await pool.query(
          `INSERT INTO ${typeConfig.tableName} (${typeConfig.idColumn}, clinic_id, is_primary) 
           VALUES ($1, $2, $3) ON CONFLICT DO NOTHING RETURNING *`,
          [userId, clinicId, isPrimary],
        )
      } else {
        result = await pool.query(
          `INSERT INTO ${typeConfig.tableName} (${typeConfig.idColumn}, clinic_id) 
           VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING *`,
          [userId, clinicId],
        )
      }

      logger.info(`${userType} ${userId} added to clinic ${clinicId}`)
      res.status(201).json({
        message: `${userType} added to clinic`,
        association: result.rows[0],
      })
    } catch (err) {
      logger.error(`Add ${userType} to clinic error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  /**
   * Associates a doctor with a clinic
   */
  static addDoctor = asyncHandler(async (req, res) => {
    await ClinicController.associateUserWithClinic(req, res, "doctor")
  })

  /**
   * Associates a nurse with a clinic
   */
  static addNurse = asyncHandler(async (req, res) => {
    await ClinicController.associateUserWithClinic(req, res, "nurse")
  })

  /**
   * Associates a lab technician with a clinic
   */
  static addLab = asyncHandler(async (req, res) => {
    await ClinicController.associateUserWithClinic(req, res, "lab")
  })

  /**
   * Associates a patient with a clinic
   */
  static addPatient = asyncHandler(async (req, res) => {
    await ClinicController.associateUserWithClinic(req, res, "patient")
  })

  /**
   * Associates an admin with a clinic
   */
  static addAdmin = asyncHandler(async (req, res) => {
    await ClinicController.associateUserWithClinic(req, res, "admin")
  })
}

module.exports = ClinicController
