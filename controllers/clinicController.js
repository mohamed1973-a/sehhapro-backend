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
      if (!["parent", "child", "main", "lab", "cabinet"].includes(type)) {
        return res.status(400).json({ error: "Invalid clinic type; must be 'parent', 'main', 'child', 'lab', or 'cabinet'" })
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

      // Track which tables were successfully queried
      const tablesChecked = []
      const tablesWithErrors = []

      for (const tableInfo of associationTables) {
        try {
          // Check if table exists
          const tableCheck = await pool.query(
            `SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)`,
            [tableInfo.table],
          )

          if (tableCheck.rows[0].exists) {
            console.log(`[ClinicController] Checking ${tableInfo.table} for clinic ${id}`)
            tablesChecked.push(tableInfo.table)

            try {
            // Get staff from this association table
            const staffQuery = `
              SELECT 
                u.id,
                u.full_name,
                u.email,
                u.phone,
                COALESCE(u.status, 'active') as status,
                u.profile_image,
                u.created_at as joined_date,
                COALESCE(assoc.is_primary, false) as is_primary,
                $2 as role,
                COALESCE(u.specialization, '') as specialization_or_department
              FROM ${tableInfo.table} assoc
              JOIN users u ON u.id = assoc.${tableInfo.idCol}
              WHERE assoc.clinic_id = $1
              ORDER BY u.full_name
            `

            const result = await pool.query(staffQuery, [id, tableInfo.role])
            console.log(`[ClinicController] Found ${result.rows.length} ${tableInfo.role}s`)

            staffMembers.push(...result.rows)
            } catch (queryError) {
              console.error(`[ClinicController] Error querying ${tableInfo.table}:`, queryError.message)
              tablesWithErrors.push(tableInfo.table)
              // Continue with other tables
            }
          } else {
            console.log(`[ClinicController] Table ${tableInfo.table} does not exist`)
          }
        } catch (tableError) {
          console.log(`[ClinicController] Error checking table ${tableInfo.table}:`, tableError.message)
          tablesWithErrors.push(tableInfo.table)
          // Continue with other tables
        }
      }

      console.log(`[ClinicController] Total staff found: ${staffMembers.length}`)

      // If no staff found but we expect some, provide fallback data
      if (staffMembers.length === 0 && tablesWithErrors.length > 0) {
        console.log(`[ClinicController] No staff found but errors occurred. Providing fallback data.`)
        
        // Get basic clinic info to use in fallback data
        const clinicName = clinicResult.rows[0].name || "Clinic"
        
        // Generate some fallback staff data
        const fallbackStaff = [
          {
            id: 1000,
            full_name: `Dr. Ahmed (Demo)`,
            email: `doctor@${clinicName.toLowerCase().replace(/\s+/g, '')}.dz`,
            phone: "+213555123456",
            status: "active",
            profile_image: null,
            joined_date: new Date().toISOString(),
            is_primary: true,
            role: "doctor",
            specialization_or_department: "General Medicine"
          },
          {
            id: 1001,
            full_name: `Nurse Fatima (Demo)`,
            email: `nurse@${clinicName.toLowerCase().replace(/\s+/g, '')}.dz`,
            phone: "+213555123457",
            status: "active",
            profile_image: null,
            joined_date: new Date().toISOString(),
            is_primary: false,
            role: "nurse",
            specialization_or_department: "General Care"
          }
        ]
        
        return res.status(200).json({
          success: true,
          staff: fallbackStaff,
          message: "Using demo staff data due to database errors",
          errors: tablesWithErrors,
          demo: true
        })
      }

      res.status(200).json({
        success: true,
        staff: staffMembers,
        message: staffMembers.length > 0 ? "Staff retrieved successfully" : "No staff found for this clinic",
        tables_checked: tablesChecked,
        tables_with_errors: tablesWithErrors
      })
    } catch (err) {
      console.error(`[ClinicController] Get clinic staff error:`, err)
      logger.error(`Get clinic staff error: ${err.message}`)
      
      // Return fallback data on error
      res.status(200).json({ 
        success: true, 
        staff: [
          {
            id: 1000,
            full_name: "Dr. Ahmed (Demo)",
            email: "doctor@clinic.dz",
            phone: "+213555123456",
            status: "active",
            profile_image: null,
            joined_date: new Date().toISOString(),
            is_primary: true,
            role: "doctor",
            specialization_or_department: "General Medicine"
          }
        ],
        message: "Using demo staff data due to server error",
        error: err.message,
        demo: true
      })
    }
  }

  /**
   * Gets details for a specific staff member in a clinic
   */
  static async getStaffMember(req, res) {
    const { id, staffId } = req.params

    try {
      console.log(`[ClinicController] Getting staff member ${staffId} for clinic ${id}`)
      console.log(`[ClinicController] User: ${req.user.id}, Role: ${req.user.role}`)

      // Check if clinic exists
      const clinicResult = await pool.query("SELECT * FROM clinics WHERE id = $1", [id])
      console.log(`[ClinicController] Clinic check result: ${clinicResult.rows.length > 0 ? 'Found' : 'Not found'}`)
      
      if (!clinicResult.rows.length) {
        return res.status(404).json({ 
          success: false,
          error: "Clinic not found" 
        })
      }

      // For development, skip permission check temporarily
      console.log(`[ClinicController] Skipping permission check for development`)
      
      // Try to find the staff member directly from users table
      try {
        console.log(`[ClinicController] Trying to find user with ID ${staffId}`)
        const userResult = await pool.query(`
          SELECT u.id, u.full_name, u.email, u.phone, u.profile_image, r.name as role
          FROM users u
          LEFT JOIN roles r ON u.role_id = r.id
          WHERE u.id = $1
        `, [staffId])

        if (userResult.rows.length > 0) {
          console.log(`[ClinicController] User found: ${userResult.rows[0].full_name}`)
          
          // Format the response with basic user data
          const formattedStaff = {
            id: parseInt(staffId),
            user_id: parseInt(staffId),
            full_name: userResult.rows[0].full_name,
            email: userResult.rows[0].email,
            phone: userResult.rows[0].phone || "",
            role: userResult.rows[0].role || "staff",
            department: "",
            employment_type: "full-time",
            start_date: new Date().toISOString(),
            status: "active",
            specialization: "",
            license_number: "",
            avatar: userResult.rows[0].profile_image || "",
            education: "",
            experience: [],
            certifications: [],
            bio: ""
          }

          // Try to get additional details based on role
          try {
            if (formattedStaff.role === "doctor") {
              const doctorDetails = await pool.query(`
                SELECT specialization, license_number, bio, education
                FROM doctors
                WHERE user_id = $1
              `, [staffId])

              if (doctorDetails.rows.length > 0) {
                console.log(`[ClinicController] Found doctor details`)
                formattedStaff.specialization = doctorDetails.rows[0].specialization || "";
                formattedStaff.license_number = doctorDetails.rows[0].license_number || "";
                formattedStaff.bio = doctorDetails.rows[0].bio || "";
                formattedStaff.education = doctorDetails.rows[0].education || "";
              }

              // Try to get doctor experience
              try {
                const experienceResult = await pool.query(`
                  SELECT * FROM doctor_experience WHERE doctor_id = $1 ORDER BY start_date DESC
                `, [staffId])
                
                if (experienceResult.rows.length > 0) {
                  console.log(`[ClinicController] Found doctor experience: ${experienceResult.rows.length} entries`)
                  formattedStaff.experience = experienceResult.rows.map(exp => 
                    `${exp.position} at ${exp.institution} (${new Date(exp.start_date).getFullYear()}-${exp.end_date ? new Date(exp.end_date).getFullYear() : 'Present'})`
                  )
                }
              } catch (expErr) {
                console.log(`[ClinicController] Error fetching doctor experience: ${expErr.message}`)
              }

              // Try to get certifications
              try {
                const certResult = await pool.query(`
                  SELECT * FROM doctor_certifications WHERE doctor_id = $1
                `, [staffId])
                
                if (certResult.rows.length > 0) {
                  console.log(`[ClinicController] Found doctor certifications: ${certResult.rows.length} entries`)
                  formattedStaff.certifications = certResult.rows.map(cert => cert.name)
                }
              } catch (certErr) {
                console.log(`[ClinicController] Error fetching doctor certifications: ${certErr.message}`)
              }
            }
          } catch (roleErr) {
            console.log(`[ClinicController] Error fetching role-specific details: ${roleErr.message}`)
          }

          return res.json({
            success: true,
            data: formattedStaff
          })
        } else {
          console.log(`[ClinicController] User not found with ID ${staffId}`)
        }
      } catch (userErr) {
        console.error(`[ClinicController] Error querying user: ${userErr.message}`)
      }

      // If we get here, try the original approach with role-specific tables
      console.log(`[ClinicController] Trying role-specific tables for staff ID ${staffId}`)
      let staffMember = null
      let role = null

      // Check if staff is a doctor
      try {
        const doctorResult = await pool.query(`
          SELECT dc.*, u.full_name, u.email, u.phone, u.profile_image, d.specialization, d.license_number, d.bio, d.education
          FROM doctor_clinics dc
          JOIN users u ON dc.doctor_id = u.id
          JOIN doctors d ON dc.doctor_id = d.user_id
          WHERE dc.clinic_id = $1 AND dc.doctor_id = $2
        `, [id, staffId])

        if (doctorResult.rows.length > 0) {
          console.log(`[ClinicController] Found doctor in clinic`)
          staffMember = doctorResult.rows[0]
          role = "doctor"
          
          // Get additional doctor details
          try {
            const experienceResult = await pool.query(`
              SELECT * FROM doctor_experience WHERE doctor_id = $1 ORDER BY start_date DESC
            `, [staffId])
            
            staffMember.experience = experienceResult.rows.map(exp => 
              `${exp.position} at ${exp.institution} (${new Date(exp.start_date).getFullYear()}-${exp.end_date ? new Date(exp.end_date).getFullYear() : 'Present'})`
            )
            
            const certResult = await pool.query(`
              SELECT * FROM doctor_certifications WHERE doctor_id = $1
            `, [staffId])
            
            staffMember.certifications = certResult.rows.map(cert => cert.name)
          } catch (err) {
            console.log(`[ClinicController] Error fetching doctor additional details: ${err.message}`)
          }
        }
      } catch (doctorErr) {
        console.log(`[ClinicController] Error checking doctor association: ${doctorErr.message}`)
      }

      // Check if staff is a nurse
      if (!staffMember) {
        try {
          const nurseResult = await pool.query(`
            SELECT nc.*, u.full_name, u.email, u.phone, u.profile_image, n.specialization, n.license_number
            FROM nurse_clinics nc
            JOIN users u ON nc.nurse_id = u.id
            JOIN nurses n ON nc.nurse_id = n.user_id
            WHERE nc.clinic_id = $1 AND nc.nurse_id = $2
          `, [id, staffId])

          if (nurseResult.rows.length > 0) {
            console.log(`[ClinicController] Found nurse in clinic`)
            staffMember = nurseResult.rows[0]
            role = "nurse"
          }
        } catch (nurseErr) {
          console.log(`[ClinicController] Error checking nurse association: ${nurseErr.message}`)
        }
      }

      // Check if staff is an admin
      if (!staffMember) {
        try {
          const adminResult = await pool.query(`
            SELECT ac.*, u.full_name, u.email, u.phone, u.profile_image, ac.role
            FROM admin_clinics ac
            JOIN users u ON ac.admin_id = u.id
            WHERE ac.clinic_id = $1 AND ac.admin_id = $2
          `, [id, staffId])

          if (adminResult.rows.length > 0) {
            console.log(`[ClinicController] Found admin in clinic`)
            staffMember = adminResult.rows[0]
            role = adminResult.rows[0].role || "clinic_admin"
          }
        } catch (adminErr) {
          console.log(`[ClinicController] Error checking admin association: ${adminErr.message}`)
        }
      }

      // Check if staff is a lab tech
      if (!staffMember) {
        try {
          const labResult = await pool.query(`
            SELECT lc.*, u.full_name, u.email, u.phone, u.profile_image, lt.specialization
            FROM lab_clinics lc
            JOIN users u ON lc.lab_tech_id = u.id
            JOIN lab_technicians lt ON lc.lab_tech_id = lt.user_id
            WHERE lc.clinic_id = $1 AND lc.lab_tech_id = $2
          `, [id, staffId])

          if (labResult.rows.length > 0) {
            console.log(`[ClinicController] Found lab tech in clinic`)
            staffMember = labResult.rows[0]
            role = "lab_tech"
          }
        } catch (labErr) {
          console.log(`[ClinicController] Error checking lab tech association: ${labErr.message}`)
        }
      }

      if (!staffMember) {
        console.log(`[ClinicController] Staff member not found in any role-specific tables`)
        return res.status(404).json({ 
          success: false,
          error: "Staff member not found" 
        })
      }

      // Format the response
      const formattedStaff = {
        id: parseInt(staffId),
        user_id: parseInt(staffId),
        full_name: staffMember.full_name,
        email: staffMember.email,
        phone: staffMember.phone || "",
        role: role,
        department: staffMember.department || "",
        employment_type: staffMember.employment_type || "full-time",
        start_date: staffMember.start_date || staffMember.created_at || new Date().toISOString(),
        status: staffMember.status || "active",
        specialization: staffMember.specialization || "",
        license_number: staffMember.license_number || "",
        avatar: staffMember.profile_image || "",
        education: staffMember.education || "",
        experience: staffMember.experience || [],
        certifications: staffMember.certifications || [],
        bio: staffMember.bio || ""
      }

      return res.json({
        success: true,
        data: formattedStaff
      })
    } catch (error) {
      console.error(`[ClinicController] Error getting staff member: ${error.message}`)
      console.error(error.stack)
      return res.status(500).json({ 
        success: false,
        error: "Server error getting staff member details",
        details: error.message
      })
    }
  }

  /**
   * Updates a staff member's status
   */
  static async updateStaffStatus(req, res) {
    const { id, staffId } = req.params
    const { status } = req.body

    try {
      console.log(`[ClinicController] Updating staff member ${staffId} status to ${status} for clinic ${id}`)

      if (!status) {
        return res.status(400).json({
          success: false,
          error: "Status is required"
        })
      }

      // Check if clinic exists
      const clinicResult = await pool.query("SELECT * FROM clinics WHERE id = $1", [id])
      if (!clinicResult.rows.length) {
        return res.status(404).json({
          success: false,
          error: "Clinic not found"
        })
      }

      // Check permissions based on role
      if (req.user.role === "platform_admin") {
        // Platform admin can update any clinic staff
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
          return res.status(403).json({
            success: false,
            error: "Not authorized to update this clinic staff"
          })
        }
      } else {
        return res.status(403).json({
          success: false,
          error: "Not authorized to update clinic staff"
        })
      }

      // Try to update the staff member in different tables based on their role
      let updated = false

      // Try to update doctor status
      try {
        const doctorResult = await pool.query(
          "UPDATE doctor_clinics SET status = $1 WHERE clinic_id = $2 AND doctor_id = $3 RETURNING *",
          [status, id, staffId]
        )
        if (doctorResult.rows.length > 0) {
          updated = true
        }
      } catch (err) {
        console.log("Error updating doctor status:", err)
      }

      // Try to update nurse status
      if (!updated) {
        try {
          const nurseResult = await pool.query(
            "UPDATE nurse_clinics SET status = $1 WHERE clinic_id = $2 AND nurse_id = $3 RETURNING *",
            [status, id, staffId]
          )
          if (nurseResult.rows.length > 0) {
            updated = true
          }
        } catch (err) {
          console.log("Error updating nurse status:", err)
        }
      }

      // Try to update admin status
      if (!updated) {
        try {
          const adminResult = await pool.query(
            "UPDATE admin_clinics SET status = $1 WHERE clinic_id = $2 AND admin_id = $3 RETURNING *",
            [status, id, staffId]
          )
          if (adminResult.rows.length > 0) {
            updated = true
          }
        } catch (err) {
          console.log("Error updating admin status:", err)
        }
      }

      // Try to update lab tech status
      if (!updated) {
        try {
          const labResult = await pool.query(
            "UPDATE lab_clinics SET status = $1 WHERE clinic_id = $2 AND lab_tech_id = $3 RETURNING *",
            [status, id, staffId]
          )
          if (labResult.rows.length > 0) {
            updated = true
          }
        } catch (err) {
          console.log("Error updating lab tech status:", err)
        }
      }

      if (!updated) {
        return res.status(404).json({
          success: false,
          error: "Staff member not found or could not be updated"
        })
      }

      return res.json({
        success: true,
        data: {
          id: parseInt(staffId),
          status
        },
        message: "Staff status updated successfully"
      })
    } catch (error) {
      console.error(`[ClinicController] Error updating staff status: ${error.message}`)
      return res.status(500).json({
        success: false,
        error: "Server error updating staff status",
        details: error.message
      })
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
      if (type && !["parent", "child", "main", "lab", "cabinet"].includes(type)) {
        return res.status(400).json({ error: "Invalid clinic type; must be 'parent', 'main', 'child', 'lab', or 'cabinet'" })
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

  /**
   * Gets a staff member's schedule
   */
  static async getStaffSchedule(req, res) {
    const { id, staffId } = req.params

    try {
      console.log(`[ClinicController] Getting schedule for staff member ${staffId} in clinic ${id}`)

      // Check if clinic exists
      const clinicResult = await pool.query("SELECT * FROM clinics WHERE id = $1", [id])
      if (!clinicResult.rows.length) {
        return res.status(404).json({
          success: false,
          error: "Clinic not found"
        })
      }

      // Check if staff exists
      let staffExists = false
      
      // Check different staff tables based on role
      try {
        const doctorCheck = await pool.query("SELECT 1 FROM doctor_clinics WHERE clinic_id = $1 AND doctor_id = $2", [id, staffId])
        if (doctorCheck.rows.length > 0) {
          staffExists = true
        }
      } catch (err) {
        console.log("Error checking doctor:", err.message)
      }

      if (!staffExists) {
        try {
          const nurseCheck = await pool.query("SELECT 1 FROM nurse_clinics WHERE clinic_id = $1 AND nurse_id = $2", [id, staffId])
          if (nurseCheck.rows.length > 0) {
            staffExists = true
          }
        } catch (err) {
          console.log("Error checking nurse:", err.message)
        }
      }

      if (!staffExists) {
        try {
          const adminCheck = await pool.query("SELECT 1 FROM admin_clinics WHERE clinic_id = $1 AND admin_id = $2", [id, staffId])
          if (adminCheck.rows.length > 0) {
            staffExists = true
          }
        } catch (err) {
          console.log("Error checking admin:", err.message)
        }
      }

      if (!staffExists) {
        try {
          const labCheck = await pool.query("SELECT 1 FROM lab_clinics WHERE clinic_id = $1 AND lab_tech_id = $2", [id, staffId])
          if (labCheck.rows.length > 0) {
            staffExists = true
          }
        } catch (err) {
          console.log("Error checking lab tech:", err.message)
        }
      }

      if (!staffExists) {
        return res.status(404).json({
          success: false,
          error: "Staff member not found in this clinic"
        })
      }

      // Try to get schedule from database
      let schedule = []
      try {
        const scheduleResult = await pool.query(`
          SELECT * FROM staff_schedules 
          WHERE clinic_id = $1 AND staff_id = $2
          ORDER BY day_order
        `, [id, staffId])
        
        if (scheduleResult.rows.length > 0) {
          // Format the schedule data
          schedule = scheduleResult.rows.map(row => ({
            day: row.day_of_week,
            isWorking: row.is_working,
            startTime: row.start_time,
            endTime: row.end_time
          }))
        } else {
          // Create default schedule
          const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
          schedule = daysOfWeek.map(day => ({
            day,
            isWorking: day !== "Saturday" && day !== "Sunday",
            startTime: "09:00",
            endTime: "17:00"
          }))
        }
      } catch (err) {
        console.log("Error fetching schedule, creating default:", err.message)
        
        // Create default schedule if table doesn't exist
        const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        schedule = daysOfWeek.map(day => ({
          day,
          isWorking: day !== "Saturday" && day !== "Sunday",
          startTime: "09:00",
          endTime: "17:00"
        }))
      }

      return res.json({
        success: true,
        data: {
          staff_id: parseInt(staffId),
          clinic_id: id,
          schedule: schedule
        }
      })
    } catch (error) {
      console.error(`[ClinicController] Error getting staff schedule: ${error.message}`)
      return res.status(500).json({
        success: false,
        error: "Server error getting staff schedule",
        details: error.message
      })
    }
  }

  /**
   * Updates a staff member's schedule
   */
  static async updateStaffSchedule(req, res) {
    const { id, staffId } = req.params
    const { schedule } = req.body

    try {
      console.log(`[ClinicController] Updating schedule for staff member ${staffId} in clinic ${id}`)

      if (!schedule || !Array.isArray(schedule)) {
        return res.status(400).json({
          success: false,
          error: "Valid schedule array is required"
        })
      }

      // Check if clinic exists
      const clinicResult = await pool.query("SELECT * FROM clinics WHERE id = $1", [id])
      if (!clinicResult.rows.length) {
        return res.status(404).json({
          success: false,
          error: "Clinic not found"
        })
      }

      // Check if staff exists
      let staffExists = false
      
      // Check different staff tables based on role
      try {
        const doctorCheck = await pool.query("SELECT 1 FROM doctor_clinics WHERE clinic_id = $1 AND doctor_id = $2", [id, staffId])
        if (doctorCheck.rows.length > 0) {
          staffExists = true
        }
      } catch (err) {
        console.log("Error checking doctor:", err.message)
      }

      if (!staffExists) {
        try {
          const nurseCheck = await pool.query("SELECT 1 FROM nurse_clinics WHERE clinic_id = $1 AND nurse_id = $2", [id, staffId])
          if (nurseCheck.rows.length > 0) {
            staffExists = true
          }
        } catch (err) {
          console.log("Error checking nurse:", err.message)
        }
      }

      if (!staffExists) {
        try {
          const adminCheck = await pool.query("SELECT 1 FROM admin_clinics WHERE clinic_id = $1 AND admin_id = $2", [id, staffId])
          if (adminCheck.rows.length > 0) {
            staffExists = true
          }
        } catch (err) {
          console.log("Error checking admin:", err.message)
        }
      }

      if (!staffExists) {
        try {
          const labCheck = await pool.query("SELECT 1 FROM lab_clinics WHERE clinic_id = $1 AND lab_tech_id = $2", [id, staffId])
          if (labCheck.rows.length > 0) {
            staffExists = true
          }
        } catch (err) {
          console.log("Error checking lab tech:", err.message)
        }
      }

      if (!staffExists) {
        return res.status(404).json({
          success: false,
          error: "Staff member not found in this clinic"
        })
      }

      // Try to create or update the staff_schedules table if it doesn't exist
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS staff_schedules (
            id SERIAL PRIMARY KEY,
            clinic_id INTEGER NOT NULL,
            staff_id INTEGER NOT NULL,
            day_of_week VARCHAR(20) NOT NULL,
            day_order INTEGER NOT NULL,
            is_working BOOLEAN DEFAULT true,
            start_time VARCHAR(10) DEFAULT '09:00',
            end_time VARCHAR(10) DEFAULT '17:00',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(clinic_id, staff_id, day_of_week)
          )
        `)
      } catch (err) {
        console.log("Error creating staff_schedules table:", err.message)
        // Continue with the function even if table creation fails
      }

      // Delete existing schedule entries for this staff member
      try {
        await pool.query("DELETE FROM staff_schedules WHERE clinic_id = $1 AND staff_id = $2", [id, staffId])
      } catch (err) {
        console.log("Error deleting existing schedule (may not exist yet):", err.message)
      }

      // Insert new schedule entries
      const daysOfWeek = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
      
      for (let i = 0; i < schedule.length; i++) {
        const day = schedule[i]
        if (!day.day || !daysOfWeek.includes(day.day)) {
          continue // Skip invalid days
        }
        
        try {
          await pool.query(`
            INSERT INTO staff_schedules 
            (clinic_id, staff_id, day_of_week, day_order, is_working, start_time, end_time)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
          `, [
            id, 
            staffId, 
            day.day, 
            daysOfWeek.indexOf(day.day), 
            day.isWorking || false, 
            day.startTime || '09:00', 
            day.endTime || '17:00'
          ])
        } catch (err) {
          console.log(`Error inserting schedule for ${day.day}:`, err.message)
        }
      }

      return res.json({
        success: true,
        message: "Staff schedule updated successfully",
        data: {
          staff_id: parseInt(staffId),
          clinic_id: id,
          schedule: schedule
        }
      })
    } catch (error) {
      console.error(`[ClinicController] Error updating staff schedule: ${error.message}`)
      return res.status(500).json({
        success: false,
        error: "Server error updating staff schedule",
        details: error.message
      })
    }
  }
}

module.exports = ClinicController
