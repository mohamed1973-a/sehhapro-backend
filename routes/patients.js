const express = require("express")
const router = express.Router()
const { protect, role } = require("../middleware/auth")
const { executeQuery } = require("../utils/dbUtils")
const logger = require("../middleware/logger")
const authMiddleware = require("../middleware/auth")

// Make sure to import the controller at the top of the file
const PatientMedicalProfileController = require("../controllers/patientMedicalProfileController")

// Add this route before the existing routes - FIXED VERSION
router.get("/search", protect, async (req, res) => {
  try {
    const { q: query, limit = 10 } = req.query
    const userRole = req.user.role
    const userId = req.user.id

    if (!query || query.length < 2) {
      return res.status(200).json({ success: true, data: [] })
    }

    let searchQuery, params

    if (userRole === "doctor") {
      // Doctors see only their patients (patients they've had appointments with)
      // REMOVED medical_conditions column that doesn't exist
      searchQuery = `
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
      params = [userId, `%${query}%`, limit]
    } else if (userRole === "clinic_admin" || userRole === "platform_admin") {
      // Admins see all patients
      // REMOVED medical_conditions column that doesn't exist
      searchQuery = `
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
      params = [`%${query}%`, limit]
    } else {
      return res.status(403).json({ error: "Access denied" })
    }

    const result = await executeQuery(searchQuery, params)

    // Parse JSON fields safely
    const patients = result.rows.map((patient) => ({
      ...patient,
      allergies: patient.allergies
        ? typeof patient.allergies === "string"
          ? JSON.parse(patient.allergies)
          : patient.allergies
        : [],
    }))

    res.status(200).json({
      success: true,
      data: patients,
    })
  } catch (error) {
    logger.error(`Search patients error: ${error.message}`)
    res.status(500).json({
      success: false,
      error: "Server error",
      details: error.message,
    })
  }
})

// Get patients (doctors see their patients, admins see all)
router.get("/", protect, async (req, res) => {
  try {
    const userRole = req.user.role
    const userId = req.user.id

    let query, params

    if (userRole === "doctor") {
      // Doctors see only their patients (patients they've had appointments with)
      query = `
        SELECT DISTINCT u.id, u.full_name, u.email, u.phone, u.created_at
        FROM users u
        JOIN appointments a ON u.id = a.patient_id
        WHERE a.doctor_id = $1 AND u.role_id = (SELECT id FROM roles WHERE name = 'patient')
        ORDER BY u.full_name
      `
      params = [userId]
    } else if (userRole === "clinic_admin" || userRole === "platform_admin") {
      // Admins see all patients
      query = `
        SELECT u.id, u.full_name, u.email, u.phone, u.created_at
        FROM users u
        WHERE u.role_id = (SELECT id FROM roles WHERE name = 'patient')
        ORDER BY u.full_name
      `
      params = []
    } else {
      return res.status(403).json({ error: "Access denied" })
    }

    const result = await executeQuery(query, params)
    res.status(200).json({
      success: true,
      data: result.rows,
    })
  } catch (error) {
    logger.error(`Get patients error: ${error.message}`)
    res.status(500).json({
      success: false,
      error: "Server error",
      details: error.message,
    })
  }
})

// Create new patient (for doctors and admins)
router.post("/", protect, async (req, res) => {
  try {
    const userRole = req.user.role
    const { full_name, email, phone } = req.body

    if (userRole !== "doctor" && userRole !== "clinic_admin" && userRole !== "platform_admin") {
      return res.status(403).json({ error: "Access denied" })
    }

    if (!full_name || !email) {
      return res.status(400).json({ error: "Full name and email are required" })
    }

    // Check if email already exists
    const existingUser = await executeQuery("SELECT id FROM users WHERE email = $1", [email])
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: "Email already exists" })
    }

    // Get patient role ID
    const roleResult = await executeQuery("SELECT id FROM roles WHERE name = 'patient'")
    if (roleResult.rows.length === 0) {
      return res.status(500).json({ error: "Patient role not found" })
    }
    const patientRoleId = roleResult.rows[0].id

    // Create the patient user
    const insertQuery = `
      INSERT INTO users (full_name, email, phone, role_id, password_hash)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, full_name, email, phone, created_at
    `

    // Generate a temporary password (should be changed on first login)
    const tempPassword = "TempPass123!" // In production, generate a secure random password
    const bcrypt = require("bcrypt")
    const passwordHash = await bcrypt.hash(tempPassword, 10)

    const result = await executeQuery(insertQuery, [full_name, email, phone || null, patientRoleId, passwordHash])

    res.status(201).json({
      success: true,
      data: result.rows[0],
      message: "Patient created successfully",
    })
  } catch (error) {
    logger.error(`Create patient error: ${error.message}`)
    res.status(500).json({
      success: false,
      error: "Server error",
      details: error.message,
    })
  }
})

// Get patient profile
router.get("/profile", protect, async (req, res) => {
  try {
    const userId = req.user.id

    if (req.user.role !== "patient") {
      return res.status(403).json({ error: "Access denied" })
    }

    const query = `
      SELECT u.id, u.full_name, u.email, u.phone, u.created_at,
             pm.emergency_contact_name, pm.emergency_contact_phone, pm.emergency_contact_relationship, pm.allergies, 
             pm.insurance_provider, pm.insurance_policy_number, pm.blood_type
      FROM users u
      LEFT JOIN patient_medical_profiles pm ON u.id = pm.patient_id
      WHERE u.id = $1
    `

    const result = await executeQuery(query, [userId])

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Patient profile not found" })
    }

    res.status(200).json({
      success: true,
      data: result.rows[0],
    })
  } catch (error) {
    logger.error(`Get patient profile error: ${error.message}`)
    res.status(500).json({
      success: false,
      error: "Server error",
      details: error.message,
    })
  }
})

// Update patient profile
router.put("/profile", protect, async (req, res) => {
  try {
    const userId = req.user.id

    if (req.user.role !== "patient") {
      return res.status(403).json({ error: "Access denied" })
    }

    const {
      full_name,
      phone,
      emergency_contact_name,
      emergency_contact_phone,
      emergency_contact_relationship,
      allergies,
      insurance_provider,
      insurance_policy_number,
      blood_type,
    } = req.body

    // Update user table
    if (full_name || phone) {
      const userUpdateQuery = `
        UPDATE users 
        SET full_name = COALESCE($1, full_name),
            phone = COALESCE($2, phone),
            updated_at = NOW()
        WHERE id = $3
      `
      await executeQuery(userUpdateQuery, [full_name, phone, userId])
    }

    // Update or insert medical profile
    const medicalProfileQuery = `
      INSERT INTO patient_medical_profiles 
      (patient_id, emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, allergies, insurance_provider, insurance_policy_number, blood_type)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (patient_id) 
      DO UPDATE SET
        emergency_contact_name = COALESCE($2, patient_medical_profiles.emergency_contact_name),
        emergency_contact_phone = COALESCE($3, patient_medical_profiles.emergency_contact_phone),
        emergency_contact_relationship = COALESCE($4, patient_medical_profiles.emergency_contact_relationship),
        allergies = COALESCE($5, patient_medical_profiles.allergies),
        insurance_provider = COALESCE($6, patient_medical_profiles.insurance_provider),
        insurance_policy_number = COALESCE($7, patient_medical_profiles.insurance_policy_number),
        blood_type = COALESCE($8, patient_medical_profiles.blood_type),
        updated_at = NOW()
    `

    await executeQuery(medicalProfileQuery, [
      userId,
      emergency_contact_name,
      emergency_contact_phone,
      emergency_contact_relationship,
      allergies,
      insurance_provider,
      insurance_policy_number,
      blood_type,
    ])

    res.status(200).json({
      success: true,
      message: "Patient profile updated successfully",
    })
  } catch (error) {
    logger.error(`Update patient profile error: ${error.message}`)
    res.status(500).json({
      success: false,
      error: "Server error",
      details: error.message,
    })
  }
})

// Get patient MHR (Medical Health Record)
router.get(
  "/:id/mhr",
  authMiddleware.protect,
  authMiddleware.role(["doctor", "nurse", "clinic_admin", "patient"]),
  async (req, res) => {
    try {
      const patientId = req.params.id
      const userId = req.user.id
      const userRole = req.user.role

      // Check permissions - patients can only view their own MHR
      if (userRole === "patient" && Number.parseInt(patientId) !== userId) {
        return res.status(403).json({
          success: false,
          error: "Access denied. You can only view your own medical records.",
        })
      }

      // Get patient basic info - REMOVED medical_conditions references
      const patientQuery = `
      SELECT 
        u.id,
        u.full_name,
        u.email,
        u.phone,
        u.date_of_birth,
        u.gender,
        u.created_at,
        pmp.height,
        pmp.weight,
        pmp.blood_type,
        pmp.allergies,
        pmp.emergency_contact_name,
        pmp.emergency_contact_phone,
        pmp.insurance_provider,
        pmp.insurance_policy_number
      FROM users u
      LEFT JOIN patient_medical_profiles pmp ON u.id = pmp.patient_id
      WHERE u.id = $1 AND u.role_id = (SELECT id FROM roles WHERE name = 'patient')
    `

      const result = await executeQuery(patientQuery, [patientId])

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Patient not found",
        })
      }

      const patient = result.rows[0]

      // Get all MHR entries (appointments, prescriptions, lab requests/results, etc.)
      const mhrEntriesQuery = `
      SELECT 
        'appointment' as entry_type,
        a.id as entry_id,
        s.start_time as entry_date,
        a.reason as title,
        a.notes as content,
        a.status,
        CONCAT('Dr. ', doc.full_name) as created_by,
        a.type as appointment_type,
        c.name as clinic_name
      FROM appointments a
      LEFT JOIN users doc ON a.doctor_id = doc.id
      LEFT JOIN clinics c ON a.clinic_id = c.id
      LEFT JOIN availability_slots s ON a.slot_id = s.id
      WHERE a.patient_id = $1

      UNION ALL

      SELECT 
        'prescription' as entry_type,
        p.id as entry_id,
        p.created_at as entry_date,
        CONCAT(p.medication_name, ' - ', p.dosage) as title,
        p.instructions as content,
        p.status,
        CONCAT('Dr. ', doc.full_name) as created_by,
        p.frequency as appointment_type,
        NULL as clinic_name
      FROM prescriptions p
      LEFT JOIN users doc ON p.doctor_id = doc.id
      WHERE p.patient_id = $1

      UNION ALL

      SELECT 
        'lab_request' as entry_type,
        lr.id as entry_id,
        lr.created_at as entry_date,
        lr.test_type as title,
        lr.notes as content,
        lr.status,
        CONCAT('Dr. ', doc.full_name) as created_by,
        lr.urgency as appointment_type,
        NULL as clinic_name
      FROM lab_requests lr
      LEFT JOIN users doc ON lr.doctor_id = doc.id
      WHERE lr.patient_id = $1

      UNION ALL

      SELECT 
        'lab_result' as entry_type,
        lres.id as entry_id,
        lres.created_at as entry_date,
        CONCAT('Lab Result: ', lr.test_type) as title,
        lres.results as content,
        'completed' as status,
        CONCAT('Dr. ', doc.full_name) as created_by,
        lres.status as appointment_type,
        NULL as clinic_name
      FROM lab_results lres
      LEFT JOIN lab_requests lr ON lres.lab_request_id = lr.id
      LEFT JOIN users tech ON lres.lab_technician_id = tech.id
      WHERE lr.patient_id = $1

      ORDER BY entry_date DESC
    `

      const mhrEntriesResult = await executeQuery(mhrEntriesQuery, [patientId, patientId, patientId, patientId])
      const mhrEntries = mhrEntriesResult.rows

      // Get current medications (active prescriptions)
      const currentMedicationsQuery = `
      SELECT 
        p.id,
        p.medication_name,
        p.dosage,
        p.frequency,
        p.instructions,
        p.start_date,
        p.end_date,
        p.status,
        CONCAT('Dr. ', doc.full_name) as prescribed_by
      FROM prescriptions p
      LEFT JOIN users doc ON p.doctor_id = doc.id
      WHERE p.patient_id = $1 AND p.status = 'active'
      ORDER BY p.created_at DESC
    `

      const currentMedicationsResult = await executeQuery(currentMedicationsQuery, [patientId])
      const currentMedications = currentMedicationsResult.rows

      // Get recent appointments
      const recentAppointmentsQuery = `
      SELECT 
        a.id,
        s.start_time as appointment_time,
        a.reason,
        a.status,
        a.type,
        CONCAT('Dr. ', doc.full_name) as doctor_name,
        c.name as clinic_name
      FROM appointments a
      LEFT JOIN users doc ON a.doctor_id = doc.id
      LEFT JOIN clinics c ON a.clinic_id = c.id
      LEFT JOIN availability_slots s ON a.slot_id = s.id
      WHERE a.patient_id = $1
      ORDER BY s.start_time DESC
      LIMIT 10
    `

      const recentAppointmentsResult = await executeQuery(recentAppointmentsQuery, [patientId])
      const recentAppointments = recentAppointmentsResult.rows

      // Parse JSON fields safely
      const parseJsonField = (field) => {
        if (!field) return []
        try {
          return typeof field === "string" ? JSON.parse(field) : field
        } catch (e) {
          return []
        }
      }

      // Construct the complete MHR
      const mhr = {
        patient_info: {
          id: patient.id,
          full_name: patient.full_name,
          email: patient.email,
          phone: patient.phone,
          date_of_birth: patient.date_of_birth,
          gender: patient.gender,
          height: patient.height,
          weight: patient.weight,
          blood_type: patient.blood_type,
          emergency_contact_name: patient.emergency_contact_name,
          emergency_contact_phone: patient.emergency_contact_phone,
          insurance_provider: patient.insurance_provider,
          insurance_policy_number: patient.insurance_policy_number,
          created_at: patient.created_at,
        },
        allergies: parseJsonField(patient.allergies),
        current_medications: currentMedications,
        recent_appointments: recentAppointments,
        mhr_entries: mhrEntries,
        summary: {
          total_appointments: mhrEntries.filter((e) => e.entry_type === "appointment").length,
          total_prescriptions: mhrEntries.filter((e) => e.entry_type === "prescription").length,
          total_lab_requests: mhrEntries.filter((e) => e.entry_type === "lab_request").length,
          total_lab_results: mhrEntries.filter((e) => e.entry_type === "lab_result").length,
          last_appointment: recentAppointments.length > 0 ? recentAppointments[0].appointment_time : null,
        },
      }

      res.json({
        success: true,
        data: mhr,
      })
    } catch (error) {
      logger.error(`Get patient MHR error: ${error.message}`)
      res.status(500).json({
        success: false,
        error: "Failed to fetch patient medical health record",
        details: error.message,
      })
    }
  },
)

// Add new MHR entry
router.post(
  "/:id/mhr/entries",
  authMiddleware.protect,
  authMiddleware.role(["doctor", "nurse", "lab"]),
  async (req, res) => {
    try {
      const patientId = req.params.id
      const { entry_type, appointment_id, data } = req.body
      const userId = req.user.id

      // Validate entry type
      const validEntryTypes = [
        "appointment_notes",
        "prescription",
        "lab_request",
        "lab_result",
        "imaging_request",
        "imaging_result",
        "treatment_plan",
        "follow_up",
        "vital_signs",
      ]

      if (!validEntryTypes.includes(entry_type)) {
        return res.status(400).json({
          success: false,
          error: "Invalid entry type",
        })
      }

      // Handle different entry types
      let result
      switch (entry_type) {
        case "prescription":
          const prescriptionQuery = `
          INSERT INTO prescriptions (
            patient_id, doctor_id, appointment_id, medication_name, 
            dosage, frequency, instructions, start_date, end_date, status
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active')
          RETURNING id
        `
          const prescriptionResult = await executeQuery(prescriptionQuery, [
            patientId,
            userId,
            appointment_id,
            data.medication_name,
            data.dosage,
            data.frequency,
            data.instructions,
            data.start_date,
            data.end_date,
          ])
          result = { insertId: prescriptionResult.rows[0].id }
          break

        case "lab_request":
          const labRequestQuery = `
          INSERT INTO lab_requests (
            patient_id, doctor_id, appointment_id, test_type, 
            urgency, notes, status
          ) VALUES ($1, $2, $3, $4, $5, $6, 'pending')
          RETURNING id
        `
          const labRequestResult = await executeQuery(labRequestQuery, [
            patientId,
            userId,
            appointment_id,
            data.test_type,
            data.urgency || "normal",
            data.notes,
          ])
          result = { insertId: labRequestResult.rows[0].id }
          break

        case "appointment_notes":
          const notesQuery = `
          UPDATE appointments 
          SET notes = $1, diagnosis = $2, treatment_plan = $3
          WHERE id = $4 AND patient_id = $5
        `
          await executeQuery(notesQuery, [data.notes, data.diagnosis, data.treatment_plan, appointment_id, patientId])
          result = { insertId: appointment_id }
          break

        default:
          return res.status(400).json({
            success: false,
            error: "Entry type not yet implemented",
          })
      }

      res.json({
        success: true,
        data: {
          entry_id: result.insertId,
          entry_type,
          message: "MHR entry added successfully",
        },
      })
    } catch (error) {
      logger.error(`Add MHR entry error: ${error.message}`)
      res.status(500).json({
        success: false,
        error: "Failed to add MHR entry",
        details: error.message,
      })
    }
  },
)

// Add this route handler for medical profiles
router.get("/:id/medical-profile", protect, PatientMedicalProfileController.getMedicalProfile)
router.put("/:id/medical-profile", protect, PatientMedicalProfileController.updateMedicalProfile)

// Add missing medical record endpoints
router.get("/:id/medical-record", protect, async (req, res) => {
  try {
    const patientId = req.params.id;
    const userId = req.user.id;
    const userRole = req.user.role;

    // Check permissions - patients can only view their own records
    if (userRole === "patient" && Number.parseInt(patientId) !== userId) {
      return res.status(403).json({
        success: false,
        error: "Access denied. You can only view your own medical records."
      });
    }

    // For doctors, check if they have a relationship with this patient
    if (userRole === "doctor") {
      const hasRelationship = await executeQuery(
        "SELECT 1 FROM appointments WHERE doctor_id = $1 AND patient_id = $2 LIMIT 1",
        [userId, patientId]
      );

      if (hasRelationship.rows.length === 0) {
        return res.status(403).json({
          success: false,
          error: "Access denied. You don't have a relationship with this patient."
        });
      }
    }

    // Get all medical records for the patient
    const recordsQuery = await executeQuery(
      `SELECT * FROM medical_records WHERE patient_id = $1 ORDER BY created_at DESC`,
      [patientId]
    );

    res.status(200).json({
      success: true,
      data: recordsQuery.rows
    });
  } catch (error) {
    logger.error(`Get patient medical record error: ${error.message}`);
    res.status(500).json({
      success: false,
      error: "Failed to fetch patient medical record",
      details: error.message
    });
  }
});

router.get("/:id/medical-record/notes", protect, async (req, res) => {
  try {
    const patientId = req.params.id;
    const userId = req.user.id;
    const userRole = req.user.role;

    // Check permissions - patients can only view their own records
    if (userRole === "patient" && Number.parseInt(patientId) !== userId) {
      return res.status(403).json({
        success: false,
        error: "Access denied. You can only view your own medical records."
      });
    }

    // Get all notes from medical records for the patient
    const notesQuery = await executeQuery(
      `SELECT id, patient_id, doctor_id, clinic_id, appointment_id, notes, created_at, updated_at
       FROM medical_records 
       WHERE patient_id = $1 AND notes IS NOT NULL
       ORDER BY created_at DESC`,
      [patientId]
    );

    res.status(200).json({
      success: true,
      data: notesQuery.rows
    });
  } catch (error) {
    logger.error(`Get patient medical notes error: ${error.message}`);
    res.status(500).json({
      success: false,
      error: "Failed to fetch patient medical notes",
      details: error.message
    });
  }
});

router.post("/:id/medical-record/notes", protect, role(["doctor", "nurse"]), async (req, res) => {
  try {
    const patientId = req.params.id;
    const { notes, appointmentId } = req.body;
    const doctorId = req.user.id;

    // Validate input
    if (!notes) {
      return res.status(400).json({
        success: false,
        error: "Notes are required"
      });
    }

    // Insert note as a medical record
    const insertQuery = await executeQuery(
      `INSERT INTO medical_records (patient_id, doctor_id, appointment_id, notes, entry_type)
       VALUES ($1, $2, $3, $4, 'note')
       RETURNING *`,
      [patientId, doctorId, appointmentId || null, notes]
    );

    res.status(201).json({
      success: true,
      data: insertQuery.rows[0],
      message: "Medical note added successfully"
    });
  } catch (error) {
    logger.error(`Add patient medical note error: ${error.message}`);
    res.status(500).json({
      success: false,
      error: "Failed to add patient medical note",
      details: error.message
    });
  }
});

router.get("/:id/medical-record/prescriptions", protect, async (req, res) => {
  try {
    const patientId = req.params.id;
    const userId = req.user.id;
    const userRole = req.user.role;

    // Check permissions - patients can only view their own records
    if (userRole === "patient" && Number.parseInt(patientId) !== userId) {
      return res.status(403).json({
        success: false,
        error: "Access denied. You can only view your own prescriptions."
      });
    }

    // Get all prescriptions for the patient
    const prescriptionsQuery = await executeQuery(
      `SELECT p.*, u.full_name as doctor_name
       FROM prescriptions p
       JOIN users u ON p.doctor_id = u.id
       WHERE p.patient_id = $1
       ORDER BY p.created_at DESC`,
      [patientId]
    );

    res.status(200).json({
      success: true,
      data: prescriptionsQuery.rows
    });
  } catch (error) {
    logger.error(`Get patient prescriptions error: ${error.message}`);
    res.status(500).json({
      success: false,
      error: "Failed to fetch patient prescriptions",
      details: error.message
    });
  }
});

router.get("/:id/medical-record/lab-imaging", protect, async (req, res) => {
  try {
    const patientId = req.params.id;
    const userId = req.user.id;
    const userRole = req.user.role;

    // Check permissions - patients can only view their own records
    if (userRole === "patient" && Number.parseInt(patientId) !== userId) {
      return res.status(403).json({
        success: false,
        error: "Access denied. You can only view your own lab results."
      });
    }

    // First check if the lab_requests table exists
    const tableCheck = await executeQuery(
      `SELECT EXISTS (
         SELECT FROM information_schema.tables 
         WHERE table_schema = 'public'
         AND table_name = 'lab_requests'
       ) as exists`
    );
    
    if (!tableCheck.rows[0].exists) {
      // Table doesn't exist, return empty data
      return res.status(200).json({
        success: true,
        data: []
      });
    }

    // Get all lab requests and results for the patient with safer joins
    try {
    const labQuery = await executeQuery(
      `SELECT 
         lr.id as request_id, 
         lr.patient_id,
         lr.doctor_id,
         lr.test_type,
           lr.test_name,
         lr.urgency,
           lr.notes as clinical_notes,
         lr.status as request_status,
         lr.created_at,
         lr.updated_at,
           COALESCE(lres.id, 0) as result_id, 
           COALESCE(lres.results, '{}') as results, 
           COALESCE(lres.status, 'pending') as result_status,
         lres.created_at as result_date, 
           u.full_name as doctor_name,
           c.name as lab_name
       FROM lab_requests lr
       LEFT JOIN users u ON lr.doctor_id = u.id
         LEFT JOIN clinics c ON lr.lab_clinic_id = c.id
       LEFT JOIN lab_results lres ON lr.id = lres.lab_request_id
       WHERE lr.patient_id = $1
       ORDER BY lr.created_at DESC`,
      [patientId]
    );

      // Process the results to ensure proper JSON parsing
      const processedResults = labQuery.rows.map(row => {
        try {
          // Parse results if it's a string
          if (row.results && typeof row.results === 'string') {
            row.results = JSON.parse(row.results);
          }
        } catch (e) {
          // If parsing fails, set to empty object
          row.results = {};
          console.error(`Failed to parse results for request ${row.request_id}: ${e.message}`);
        }
        return row;
      });

      return res.status(200).json({
      success: true,
        data: processedResults
      });
    } catch (queryError) {
      logger.error(`Lab query error: ${queryError.message}`);
      // Return empty data on query error rather than failing
      return res.status(200).json({
        success: true,
        data: [],
        warning: "Error querying lab data"
    });
    }
  } catch (error) {
    logger.error(`Get patient lab results error: ${error.message}`);
    res.status(500).json({
      success: false,
      error: "Failed to fetch patient lab results",
      details: error.message
    });
  }
});

// Get patient by ID
router.get("/:id", protect, async (req, res) => {
  try {
    const patientId = req.params.id
    const userId = req.user.id
    const userRole = req.user.role

    // Verify doctor has access to this patient
    if (userRole === "doctor") {
      const hasAccess = await executeQuery(
        `SELECT 1 FROM appointments 
         WHERE doctor_id = $1 AND patient_id = $2 LIMIT 1`,
        [userId, patientId]
      )
      if (hasAccess.rows.length === 0) {
        return res.status(403).json({ error: "Access denied" })
      }
    } else if (userRole !== "clinic_admin" && userRole !== "platform_admin") {
      return res.status(403).json({ error: "Access denied" })
    }

    // Get patient basic info - corrected to match actual schema
    const patientQuery = `
      SELECT 
        u.id, u.full_name, u.email, u.phone, 
        pmp.date_of_birth, pmp.gender, u.created_at,
        pmp.blood_type, pmp.allergies, pmp.emergency_contact_name,
        pmp.emergency_contact_phone, pmp.insurance_provider,
        pmp.insurance_policy_number
       FROM users u
       LEFT JOIN patient_medical_profiles pmp ON u.id = pmp.patient_id
      WHERE u.id = $1 AND u.role_id = (SELECT id FROM roles WHERE name = 'patient')
    `

    const result = await executeQuery(patientQuery, [patientId])

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Patient not found" })
    }

    const patient = result.rows[0]

    // Parse JSON fields
    if (patient.allergies && typeof patient.allergies === "string") {
      patient.allergies = JSON.parse(patient.allergies)
    }

    res.status(200).json({
      success: true,
      data: patient
    })

  } catch (error) {
    logger.error(`Get patient by ID error: ${error.message}`)
    res.status(500).json({
      success: false,
      error: "Failed to fetch patient data",
      details: error.message
    })
  }
})

// Get patient medical history
router.get("/:id/medical-history", protect, async (req, res) => {
  try {
    const patientId = req.params.id
    const userRole = req.user.role
    const userId = req.user.id

    // Verify authorization
    if (userRole !== "doctor" && userRole !== "clinic_admin" && userId !== Number(patientId)) {
      return res.status(403).json({ error: "Not authorized to access these records" })
    }

    // If doctor, verify doctor-patient relationship
    if (userRole === "doctor") {
      const relationshipCheck = await executeQuery(
        `SELECT 1 FROM appointments 
         WHERE doctor_id = $1 AND patient_id = $2 
         UNION 
         SELECT 1 FROM doctor_clinics dc 
         JOIN patient_clinics pc ON dc.clinic_id = pc.clinic_id 
         WHERE dc.doctor_id = $1 AND pc.patient_id = $2
         LIMIT 1`,
        [userId, patientId]
      )

      if (relationshipCheck.rows.length === 0) {
        return res.status(403).json({ error: "Not authorized to access records for this patient" })
      }
    }

    // Fetch medical records with related data
    const recordsQuery = `
      SELECT 
        mr.*,
        u.full_name AS doctor_name,
        a.scheduled_for AS appointment_date,
        COALESCE(
          json_agg(
            json_build_object(
              'id', md.id,
              'filename', md.filename,
              'file_type', md.file_type,
              'file_size', md.file_size,
              'file_url', md.file_url,
              'uploaded_by', md.uploaded_by,
              'uploaded_at', md.uploaded_at
            )
          ) FILTER (WHERE md.id IS NOT NULL),
          '[]'
        ) as documents
      FROM medical_records mr
      JOIN users u ON mr.doctor_id = u.id
      LEFT JOIN appointments a ON mr.appointment_id = a.id
      LEFT JOIN medical_documents md ON mr.id = md.record_id
      WHERE mr.patient_id = $1
      GROUP BY mr.id, u.full_name, a.scheduled_for
      ORDER BY mr.created_at DESC
    `

    const result = await executeQuery(recordsQuery, [patientId])

    // Format the response according to the frontend types
    const formattedRecords = result.rows.map(record => ({
      id: record.id.toString(),
      patient_id: record.patient_id.toString(),
      doctor_id: record.doctor_id.toString(),
      appointment_id: record.appointment_id ? record.appointment_id.toString() : null,
      record_type: record.entry_type,
      diagnosis: record.diagnosis || "",
      treatment: record.treatment || "",
      notes: record.notes || "",
      created_at: record.created_at.toISOString(),
      updated_at: record.updated_at.toISOString(),
      doctor_name: record.doctor_name,
      appointment_date: record.appointment_date ? record.appointment_date.toISOString() : null,
      documents: record.documents || []
    }))

    res.json({
      success: true,
      data: {
        records: formattedRecords,
        total_count: formattedRecords.length,
        last_updated: formattedRecords[0]?.updated_at || new Date().toISOString()
      }
    })
  } catch (error) {
    logger.error(`Get patient medical history error: ${error.message}`)
    res.status(500).json({
      success: false,
      error: "Server error",
      details: error.message
    })
  }
})

module.exports = router
