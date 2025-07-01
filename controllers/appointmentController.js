const { pool } = require("../config/database")
const logger = require("../middleware/logger")
const { executeQuery } = require("../utils/dbUtils")
const PaymentService = require("../services/paymentService")

// Helper function to parse date strings without timezone conversion
function parseLocalDateString(dateTimeString) {
  // If the string already has timezone info, use it as is
  if (dateTimeString.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(dateTimeString)) {
    return new Date(dateTimeString)
  }

  // Remove any milliseconds and parse as local time
  const cleanDateString = dateTimeString.split(".")[0]
  const [datePart, timePart] = cleanDateString.split("T")

  if (!timePart) {
    // If only date is provided (YYYY-MM-DD)
    const [year, month, day] = datePart.split("-").map(Number)
    return new Date(year, month - 1, day)
  }

  // If date and time are provided (YYYY-MM-DDTHH:MM:SS)
  const [year, month, day] = datePart.split("-").map(Number)
  const [hour, minute, second] = timePart.split(":").map(Number)
  return new Date(year, month - 1, day, hour, minute, second || 0)
}

// Format date for database without timezone conversion
function formatDateForDB(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  const hours = String(date.getHours()).padStart(2, "0")
  const minutes = String(date.getMinutes()).padStart(2, "0")
  const seconds = String(date.getSeconds()).padStart(2, "0")

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

const AppointmentController = {
  // Get all appointments for the current user
  async getAll(req, res) {
    try {
      const userId = req.user.id
      const userRole = req.user.role

      let query, params

      if (userRole === "patient") {
        query = `
          SELECT a.*, u1.full_name AS patient_name, u2.full_name AS doctor_name,
                 c.name AS clinic_name, s.start_time AS appointment_time,
                 s.end_time AS appointment_end_time
          FROM appointments a
          JOIN users u1 ON a.patient_id = u1.id
          JOIN users u2 ON a.doctor_id = u2.id
          LEFT JOIN clinics c ON a.clinic_id = c.id
          LEFT JOIN availability_slots s ON a.slot_id = s.id
          WHERE a.patient_id = $1
          ORDER BY COALESCE(s.start_time, a.created_at) DESC
        `
        params = [userId]
      } else if (userRole === "doctor") {
        query = `
          SELECT a.*, u1.full_name AS patient_name, u2.full_name AS doctor_name,
                 c.name AS clinic_name, s.start_time AS appointment_time,
                 s.end_time AS appointment_end_time
          FROM appointments a
          JOIN users u1 ON a.patient_id = u1.id
          JOIN users u2 ON a.doctor_id = u2.id
          LEFT JOIN clinics c ON a.clinic_id = c.id
          LEFT JOIN availability_slots s ON a.slot_id = s.id
          WHERE a.doctor_id = $1
          ORDER BY COALESCE(s.start_time, a.created_at) DESC
        `
        params = [userId]
      } else {
        // Admin users see all appointments
        query = `
          SELECT a.*, u1.full_name AS patient_name, u2.full_name AS doctor_name,
                 c.name AS clinic_name, s.start_time AS appointment_time,
                 s.end_time AS appointment_end_time
          FROM appointments a
          JOIN users u1 ON a.patient_id = u1.id
          JOIN users u2 ON a.doctor_id = u2.id
          LEFT JOIN clinics c ON a.clinic_id = c.id
          LEFT JOIN availability_slots s ON a.slot_id = s.id
          ORDER BY COALESCE(s.start_time, a.created_at) DESC
        `
        params = []
      }

      const result = await executeQuery(query, params)
      res.status(200).json({ success: true, data: result.rows })
    } catch (error) {
      logger.error(`Get all appointments error: ${error.message}`)
      res.status(500).json({ 
        success: false, 
        error: "Failed to retrieve appointments", 
        details: error.message,
        code: "APPOINTMENT_FETCH_ERROR"
      })
    }
  },

  // Get appointment by ID
  async getById(req, res) {
    try {
      const appointmentId = req.params.id
      const userId = req.user.id
      const userRole = req.user.role

      // Validate that appointmentId is a number
      if (isNaN(appointmentId) || !Number.isInteger(Number(appointmentId))) {
        logger.warn(`Invalid appointment ID format: ${appointmentId}`)
        return res.status(400).json({ 
          success: false, 
          error: "Invalid appointment ID format",
          code: "INVALID_APPOINTMENT_ID"
        })
      }

      logger.info(`Fetching appointment ${appointmentId} for user ${userId} with role ${userRole}`)

      // First, check if the appointment exists at all
      const existsQuery = `SELECT id, patient_id, doctor_id FROM appointments WHERE id = $1`
      const existsResult = await executeQuery(existsQuery, [appointmentId])

      if (existsResult.rows.length === 0) {
        logger.warn(`Appointment ${appointmentId} not found in database`)
        return res.status(404).json({ 
          success: false, 
          error: "Appointment not found",
          code: "APPOINTMENT_NOT_FOUND"
        })
      }

      const appointmentBasic = existsResult.rows[0]
      logger.info(
        `Appointment ${appointmentId} exists. Patient: ${appointmentBasic.patient_id}, Doctor: ${appointmentBasic.doctor_id}`,
      )

      // Use a safer query that only selects columns that should exist
      let query = `
  SELECT a.*, 
         u1.full_name AS patient_name,
         u1.email AS patient_email, 
         u1.phone AS patient_phone,
         u2.full_name AS doctor_name,
         u2.email AS doctor_email,
         u2.phone AS doctor_phone,
         c.name AS clinic_name,
         c.address AS clinic_address,
         c.phone AS clinic_phone,
         s.start_time AS appointment_time,  
         s.end_time AS appointment_end_time,
         ts.id AS telemedicine_session_id, 
         ts.status AS session_status,
         ts.notes AS session_notes, 
         ts.session_summary,
         ts.session_url,
         dp.specialty AS doctor_specialty
  FROM appointments a
  LEFT JOIN users u1 ON a.patient_id = u1.id
  LEFT JOIN users u2 ON a.doctor_id = u2.id
  LEFT JOIN clinics c ON a.clinic_id = c.id
  LEFT JOIN availability_slots s ON a.slot_id = s.id
  LEFT JOIN telemedicine_sessions ts ON a.id = ts.appointment_id
  LEFT JOIN doctor_portfolios dp ON a.doctor_id = dp.doctor_id   
  WHERE a.id = $1
`

      const params = [appointmentId]

      // Add user-specific filtering for non-admin users
      if (userRole === "patient") {
        query += ` AND a.patient_id = $2`
        params.push(userId)
      } else if (userRole === "doctor") {
        query += ` AND a.doctor_id = $2`
        params.push(userId)
      }

      logger.info(`Executing query: ${query} with params: ${JSON.stringify(params)}`)

      const result = await executeQuery(query, params)

      if (result.rows.length === 0) {
        logger.warn(`Appointment ${appointmentId} not found or access denied for user ${userId}`)
        return res.status(404).json({ 
          success: false, 
          error: "Appointment not found or access denied",
          code: "APPOINTMENT_ACCESS_DENIED"
        })
      }

      logger.info(`Successfully retrieved appointment ${appointmentId}`)
      res.status(200).json({ success: true, data: result.rows[0] })
    } catch (error) {
      logger.error(`Get appointment by ID error: ${error.message}`)
      logger.error(`Stack trace: ${error.stack}`)
      res.status(500).json({ 
        success: false, 
        error: "Failed to retrieve appointment", 
        details: error.message,
        code: "APPOINTMENT_FETCH_ERROR"
      })
    }
  },

  // Get doctor's appointments with optional date filter
  async getDoctorAppointments(req, res) {
    try {
      const doctorId = req.user.id
      const { date } = req.query

      logger.info(`Fetching appointments for doctor ${doctorId}${date ? ` on date ${date}` : ""}`)

      let query = `
        SELECT a.*, u.full_name AS patient_name, c.name AS clinic_name,
               s.start_time AS appointment_time, s.end_time AS appointment_end_time
        FROM appointments a
        JOIN users u ON a.patient_id = u.id
        LEFT JOIN clinics c ON a.clinic_id = c.id
        LEFT JOIN availability_slots s ON a.slot_id = s.id
        WHERE a.doctor_id = $1
      `

      const params = [doctorId]

      if (date) {
        query += ` AND (DATE(s.start_time) = $2 OR (s.start_time IS NULL AND DATE(a.created_at) = $2))`
        params.push(date)
      }

      query += ` ORDER BY COALESCE(s.start_time, a.created_at) ASC`

      const result = await executeQuery(query, params)

      logger.info(`Found ${result.rows.length} appointments for doctor ${doctorId}`)
      res.status(200).json({ success: true, data: result.rows })
    } catch (error) {
      logger.error(`Get doctor appointments error: ${error.message}`)
      res.status(500).json({ success: false, error: "Server error", details: error.message })
    }
  },

  // Create a new appointment
  async create(req, res) {
    try {
      const { 
        doctorId, 
        clinicId, 
        date, 
        reason, 
        type, 
        specialty, 
        duration = 30,
        paymentMethod = 'balance',
        appointmentFee = 0
      } = req.body
      const userRole = req.user.role
      const userId = req.user.id

      console.log("Received appointment request:", {
        doctorId,
        clinicId,
        date,
        reason,
        type,
        patientId: req.body.patientId,
        specialty,
        duration,
        paymentMethod,
        appointmentFee,
        userRole,
        userId,
      })

      // Determine patient ID
      let patientId
      if (userRole === "patient") {
        patientId = userId
      } else if (req.body.patientId) {
        patientId = req.body.patientId
      } else {
        if (req.dbTransaction) {
          await req.dbTransaction.rollback()
        }
        return res.status(400).json({ error: "Patient ID is required for non-patient users" })
      }

      // Determine the final clinic ID based on appointment type and user role
      let finalClinicId = clinicId

      if (type === "in-person") {
        if ((finalClinicId === null || finalClinicId === undefined) && userRole === "doctor") {
          console.log("Doctor creating in-person appointment without clinic - auto-assigning...")

          // Try to find any clinic the doctor is associated with via availability_slots
          const doctorClinicQuery = `
            SELECT DISTINCT clinic_id 
            FROM availability_slots 
            WHERE provider_id = $1 AND provider_type = 'doctor' AND clinic_id IS NOT NULL
            LIMIT 1
          `
          const doctorClinicResult = await req.dbTransaction.query(doctorClinicQuery, [doctorId])

          if (doctorClinicResult.rows.length > 0) {
            finalClinicId = doctorClinicResult.rows[0].clinic_id
            console.log(`Using doctor's associated clinic: ${finalClinicId}`)
          } else {
            // If no clinic found in availability_slots, try to find any clinic in the system
            const anyClinicQuery = `SELECT id FROM clinics WHERE status = 'active' LIMIT 1`
            const anyClinicResult = await req.dbTransaction.query(anyClinicQuery)

            if (anyClinicResult.rows.length > 0) {
              finalClinicId = anyClinicResult.rows[0].id
              console.log(`Using default active clinic: ${finalClinicId}`)
            } else {
              // Last resort: any clinic at all
              const lastResortQuery = `SELECT id FROM clinics LIMIT 1`
              const lastResortResult = await req.dbTransaction.query(lastResortQuery)

              if (lastResortResult.rows.length > 0) {
                finalClinicId = lastResortResult.rows[0].id
                console.log(`Using any available clinic: ${finalClinicId}`)
              }
            }
          }
        }

        // Final validation for in-person appointments
        if (!finalClinicId) {
          if (req.dbTransaction) {
            await req.dbTransaction.rollback()
          }
          return res.status(400).json({
            error:
              userRole === "doctor"
                ? "No clinic found for doctor. Please ensure the doctor is associated with a clinic or contact an administrator."
                : "Clinic ID is required for in-person appointments.",
          })
        }
      } else if (type === "telemedicine") {
        // For telemedicine, clinic should be null
        finalClinicId = null
      }

      // Get doctor's specialty if not provided
      let doctorSpecialty = specialty
      if (!doctorSpecialty) {
        const doctorQuery = `
          SELECT dp.specialty 
          FROM doctor_portfolios dp 
          WHERE dp.doctor_id = $1
        `
        const doctorResult = await req.dbTransaction.query(doctorQuery, [doctorId])
        doctorSpecialty = doctorResult.rows[0]?.specialty || "General Medicine"
      }

      console.log("Processing appointment:", {
        type,
        patientId,
        doctorId,
        clinicId: finalClinicId,
        date,
        specialty: doctorSpecialty,
      })

      // Parse the appointment date
      const appointmentDate = parseLocalDateString(date)
      const endTime = new Date(appointmentDate.getTime() + duration * 60 * 1000)

      console.log("Appointment date (local time):", appointmentDate)
      console.log("End time (local time):", endTime)

      // Check if there's an existing availability slot
      const slotQuery = `
        SELECT id, is_available FROM availability_slots 
        WHERE provider_id = $1 
        AND provider_type = 'doctor'
        AND start_time <= $2 
        AND end_time >= $3
        AND is_available = TRUE
      `

      const slotParams = [doctorId, formatDateForDB(appointmentDate), formatDateForDB(endTime)]

      console.log("=== SLOT SEARCH DEBUG ===")
      console.log("Searching for available slot with query:", slotQuery)
      console.log("Slot search params:", slotParams)

      const existingSlot = await req.dbTransaction.query(slotQuery, slotParams)

      console.log("Found existing slots:", existingSlot.rows.length)
      if (existingSlot.rows.length > 0) {
        console.log("Existing slot details:", existingSlot.rows[0])
      }

      let slotId
      if (existingSlot.rows.length > 0) {
        slotId = existingSlot.rows[0].id
        console.log("Using existing slot:", slotId, "- Available:", existingSlot.rows[0].is_available)
      } else {
        // Create a new availability slot
        const createSlotQuery = `
          INSERT INTO availability_slots 
          (provider_id, provider_type, clinic_id, start_time, end_time, is_available)
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id, is_available
        `
        const createSlotParams = [
          doctorId,
          "doctor",
          type === "in-person" ? finalClinicId : null,
          formatDateForDB(appointmentDate),
          formatDateForDB(endTime),
          true, // Initially available, will be marked unavailable after appointment creation
        ]

        console.log("Creating new slot from", appointmentDate, "to", endTime)
        console.log("Create slot params:", createSlotParams)

        const newSlot = await req.dbTransaction.query(createSlotQuery, createSlotParams)
        slotId = newSlot.rows[0].id
        console.log("Created new slot:", slotId, "- Available:", newSlot.rows[0].is_available)
      }

      // Check if specialty column exists in appointments table
      const checkColumnQuery = `
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'appointments' AND column_name = 'specialty'
      `
      const columnCheck = await req.dbTransaction.query(checkColumnQuery)
      const hasSpecialtyColumn = columnCheck.rows.length > 0

      // Create the appointment
      let appointmentQuery, appointmentParams

      if (hasSpecialtyColumn) {
        appointmentQuery = `
          INSERT INTO appointments 
          (patient_id, doctor_id, clinic_id, slot_id, status, type, reason, specialty)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          RETURNING *
        `
        appointmentParams = [patientId, doctorId, finalClinicId, slotId, "booked", type, reason, doctorSpecialty]
      } else {
        appointmentQuery = `
          INSERT INTO appointments 
          (patient_id, doctor_id, clinic_id, slot_id, status, type, reason)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING *
        `
        appointmentParams = [patientId, doctorId, finalClinicId, slotId, "booked", type, reason]
      }

      console.log("Appointment Query:", appointmentQuery)
      console.log("Appointment Params:", appointmentParams)

      const result = await req.dbTransaction.query(appointmentQuery, appointmentParams)
      const appointment = result.rows[0]

      console.log("Created appointment:", appointment.id)

      // Debug log for transaction
      console.log("=== PAYMENT DEBUG ===")
      console.log("Transaction object:", req.dbTransaction ? "Present" : "Missing")
      console.log("Transaction client:", req.dbTransaction?.client ? "Present" : "Missing")
      console.log("Transaction methods:", Object.keys(req.dbTransaction || {}))
      console.log("Payment method:", paymentMethod)
      console.log("Appointment fee:", appointmentFee)

      // Validate paymentMethod and appointmentFee before processing payment
      let paymentResult = null
      // Check if we need to process payment - either explicit fee or default fee
      const effectiveAppointmentFee = appointmentFee || 1000; // Default to 1000 if not specified
      const effectivePaymentMethod = paymentMethod || 'balance'; // Default to balance if not specified

      console.log("Effective appointment fee:", effectiveAppointmentFee)
      console.log("Effective payment method:", effectivePaymentMethod)

      // Always process payment unless explicitly set to zero
      if (effectiveAppointmentFee > 0) {
        try {
          paymentResult = await PaymentService.processAppointmentPayment({
            appointmentId: appointment.id,
            patientId,
            doctorId,
            appointmentType: type,
            paymentMethod: effectivePaymentMethod,
            amount: effectiveAppointmentFee,
            dbTransaction: req.dbTransaction
          })
          console.log("Payment processed:", paymentResult)
        } catch (paymentError) {
          console.error("Payment processing failed:", paymentError.message)
          // Log error but do not rollback entire transaction to avoid silent failure
          logger.error(`Payment processing failed for appointment ${appointment.id}: ${paymentError.message}`)
          // Optionally, set paymentResult to indicate failure
          paymentResult = {
            success: false,
            error: paymentError.message,
            code: "PAYMENT_FAILED"
          }
          // Do not return here, continue to commit transaction and respond with warning
        }
      } else {
        console.log("Skipping payment processing - zero fee appointment")
      }

      // After payment processing
      console.log("=== END PAYMENT DEBUG ===")
      console.log("Payment result:", paymentResult)

      // Create telemedicine session if needed
      if (type === "telemedicine") {
        // First check what columns exist in telemedicine_sessions table
        const checkTelemedicineColumnsQuery = `
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'telemedicine_sessions'
          ORDER BY column_name
        `
        const columnsResult = await req.dbTransaction.query(checkTelemedicineColumnsQuery)
        const availableColumns = columnsResult.rows.map((row) => row.column_name)

        console.log("Available telemedicine_sessions columns:", availableColumns)

        // Build the insert query based on available columns
        let sessionQuery
        let sessionParams

        // Always use appointmentId as session id
        if (availableColumns.includes("patient_id") && availableColumns.includes("doctor_id")) {
          sessionQuery = `
            INSERT INTO telemedicine_sessions 
            (id, appointment_id, patient_id, doctor_id, status, started_at)
            VALUES ($1, $1, $2, $3, $4, NOW())
            ON CONFLICT (id) DO NOTHING
            RETURNING id
          `
          sessionParams = [appointmentId, appointment.patient_id, appointment.doctor_id, "in-progress"]
        } else if (availableColumns.includes("doctor_id")) {
          sessionQuery = `
            INSERT INTO telemedicine_sessions 
            (id, appointment_id, doctor_id, status, started_at)
            VALUES ($1, $1, $2, $3, NOW())
            ON CONFLICT (id) DO NOTHING
            RETURNING id
          `
          sessionParams = [appointmentId, appointment.doctor_id, "in-progress"]
        } else {
          sessionQuery = `
            INSERT INTO telemedicine_sessions 
            (id, appointment_id, status, started_at)
            VALUES ($1, $1, $2, NOW())
            ON CONFLICT (id) DO NOTHING
            RETURNING id
          `
          sessionParams = [appointmentId, "in-progress"]
        }

        console.log("Telemedicine session query:", sessionQuery)
        console.log("Telemedicine session params:", sessionParams)

        await req.dbTransaction.query(sessionQuery, sessionParams)
      }

      // CRITICAL: Mark the slot as unavailable - This is the main fix
      console.log("=== SLOT UPDATE DEBUG ===")
      console.log("Updating slot ID:", slotId)
      console.log("Slot exists:", slotId ? "YES" : "NO")

      // First, verify the slot exists and is currently available
      const verifySlotQuery = `SELECT id, is_available FROM availability_slots WHERE id = $1`
      const verifySlotResult = await req.dbTransaction.query(verifySlotQuery, [slotId])

      if (verifySlotResult.rows.length === 0) {
        console.log("ERROR: Slot not found for update!")
        throw new Error(`Availability slot ${slotId} not found`)
      }

      console.log("Slot before update:", verifySlotResult.rows[0])

      const updateResult = await req.dbTransaction.query(
        "UPDATE availability_slots SET is_available = FALSE WHERE id = $1 RETURNING id, is_available",
        [slotId],
      )

      console.log("Update result rows affected:", updateResult.rowCount)
      console.log("Slot after update:", updateResult.rows[0])

      if (updateResult.rowCount === 0) {
        console.log("WARNING: No rows were updated when marking slot as unavailable!")
        throw new Error(`Failed to update availability slot ${slotId}`)
      }

      console.log("=== END SLOT UPDATE ===")

      // Commit the transaction
      await req.dbTransaction.commit()

      logger.info(`Appointment created successfully: ${appointment.id}, Slot ${slotId} marked as unavailable`)

      // Get the full appointment details with all joins for the response
      const fullAppointmentQuery = `
        SELECT a.*, 
               u1.full_name AS patient_name, 
               u2.full_name AS doctor_name,
               c.name AS clinic_name, 
               c.address AS clinic_address,
               s.start_time AS appointment_time,  
               s.end_time AS appointment_end_time,
               s.is_available AS slot_available,
               ts.id AS telemedicine_session_id, 
               ts.status AS session_status
        FROM appointments a
        LEFT JOIN users u1 ON a.patient_id = u1.id
        LEFT JOIN users u2 ON a.doctor_id = u2.id
        LEFT JOIN clinics c ON a.clinic_id = c.id
        LEFT JOIN availability_slots s ON a.slot_id = s.id
        LEFT JOIN telemedicine_sessions ts ON a.id = ts.appointment_id   
        WHERE a.id = $1
      `

      const fullAppointmentResult = await executeQuery(fullAppointmentQuery, [appointment.id])
      const fullAppointment = fullAppointmentResult.rows[0] || appointment

      console.log("Final appointment with slot status:", {
        appointmentId: fullAppointment.id,
        slotId: fullAppointment.slot_id,
        slotAvailable: fullAppointment.slot_available,
      })

      res.status(201).json({
        success: true,
        data: fullAppointment,
        message: "Appointment created successfully",
      })
    } catch (error) {
      // Rollback transaction on error
      if (req.dbTransaction) {
        await req.dbTransaction.rollback()
      }
      logger.error(`Create appointment error: ${error.message}`)
      console.log("Full error:", error)
      res.status(500).json({ success: false, error: "Server error", details: error.message })
    }
  },

  // Update appointment
  async update(req, res) {
    try {
      const appointmentId = req.params.id
      const { status, notes, checkInTime, checkOutTime, errorReason } = req.body
      const userId = req.user.id
      const userRole = req.user.role

      // Validate status if provided
      const validStatuses = [
        'booked', 'in-progress', 'completed', 'cancelled', 
        'no-show', 'missed', 'late', 'rescheduled', 'error'
      ]
      
      if (status && !validStatuses.includes(status)) {
        return res.status(400).json({ 
          success: false, 
          error: "Invalid appointment status",
          code: "INVALID_STATUS",
          validStatuses 
        })
      }

      // Check if user has permission to update this appointment
      const permissionQuery = `
        SELECT a.*, s.start_time, s.end_time
        FROM appointments a 
        LEFT JOIN availability_slots s ON a.slot_id = s.id 
        WHERE a.id = $1
      `
      const permissionResult = await req.dbTransaction.query(permissionQuery, [appointmentId])

      if (permissionResult.rows.length === 0) {
        await req.dbTransaction.rollback()
        return res.status(404).json({ 
          success: false, 
          error: "Appointment not found",
          code: "APPOINTMENT_NOT_FOUND"
        })
      }

      const appointment = permissionResult.rows[0]

      // Check permissions based on status and role
      if (userRole === "patient") {
        // Patients can only cancel or mark as no-show for their own appointments
        if (appointment.patient_id !== userId) {
          await req.dbTransaction.rollback()
          return res.status(403).json({ 
            success: false, 
            error: "Access denied - you can only manage your own appointments",
            code: "ACCESS_DENIED"
          })
        }
        
        if (status && !['cancelled', 'no-show'].includes(status)) {
          await req.dbTransaction.rollback()
          return res.status(403).json({ 
            success: false, 
            error: "Patients can only cancel appointments or mark as no-show",
            code: "INSUFFICIENT_PERMISSIONS"
          })
        }
      }

      if (userRole === "doctor" && appointment.doctor_id !== userId) {
        await req.dbTransaction.rollback()
        return res.status(403).json({ 
          success: false, 
          error: "Access denied - you can only manage your own appointments",
          code: "ACCESS_DENIED"
        })
      }

      // Additional validation for specific statuses
      if (status === 'no-show') {
        // Check if appointment time has passed
        if (appointment.start_time && new Date(appointment.start_time) > new Date()) {
          return res.status(400).json({
            success: false,
            error: "Cannot mark as no-show before appointment time",
            code: "INVALID_NO_SHOW_TIME"
          })
        }
      }

      if (status === 'late') {
        // Check if appointment is within reasonable time window
        if (appointment.start_time) {
          const appointmentTime = new Date(appointment.start_time)
          const now = new Date()
          const timeDiff = now.getTime() - appointmentTime.getTime()
          const minutesLate = Math.floor(timeDiff / (1000 * 60))
          
          if (minutesLate < 5) {
            return res.status(400).json({
              success: false,
              error: "Cannot mark as late until 5 minutes after scheduled time",
              code: "TOO_EARLY_FOR_LATE_STATUS"
            })
          }
          
          if (minutesLate > 60) {
            return res.status(400).json({
              success: false,
              error: "Appointment is too late to mark as 'late'. Consider marking as 'missed' instead",
              code: "TOO_LATE_FOR_LATE_STATUS"
            })
          }
        }
      }

      // Build update query dynamically
      const updates = []
      const params = []
      let paramCount = 1

      if (status) {
        updates.push(`status = $${paramCount}`)
        params.push(status)
        paramCount++
      }

      if (notes) {
        updates.push(`notes = $${paramCount}`)
        params.push(notes)
        paramCount++
      }

      if (checkInTime) {
        updates.push(`check_in_time = $${paramCount}`)
        params.push(checkInTime)
        paramCount++
      }

      if (checkOutTime) {
        updates.push(`check_out_time = $${paramCount}`)
        params.push(checkOutTime)
        paramCount++
      }

      // Add error reason for error status
      if (status === 'error' && errorReason) {
        updates.push(`notes = COALESCE(notes, '') || $${paramCount}`)
        params.push(`\nError Reason: ${errorReason}`)
        paramCount++
      }

      if (updates.length === 0) {
        await req.dbTransaction.rollback()
        return res.status(400).json({ 
          success: false, 
          error: "No valid fields to update",
          code: "NO_UPDATES_PROVIDED"
        })
      }

      updates.push(`updated_at = NOW()`)
      params.push(appointmentId)

      const updateQuery = `
        UPDATE appointments 
        SET ${updates.join(", ")} 
        WHERE id = $${paramCount}
        RETURNING *
      `

      const result = await req.dbTransaction.query(updateQuery, params)

      // Handle slot availability based on status
      if (appointment.slot_id) {
        if (['cancelled', 'no-show', 'missed', 'error'].includes(status)) {
          // Make slot available again for these statuses
          console.log(`Marking slot ${appointment.slot_id} as available due to status: ${status}`)
          
          const slotUpdateResult = await req.dbTransaction.query(
            "UPDATE availability_slots SET is_available = TRUE WHERE id = $1 RETURNING id, is_available",
            [appointment.slot_id],
          )
          
          console.log("Slot update result:", slotUpdateResult.rows[0])
        } else if (status === 'in-progress') {
          // Ensure slot is marked as unavailable when appointment starts
          await req.dbTransaction.query(
            "UPDATE availability_slots SET is_available = FALSE WHERE id = $1",
            [appointment.slot_id],
          )
        }
      }

      // Commit the transaction
      await req.dbTransaction.commit()

      logger.info(`Appointment ${appointmentId} updated to status: ${status || 'unchanged'}`)
      res.status(200).json({ 
        success: true, 
        data: result.rows[0],
        message: `Appointment ${status ? `marked as ${status}` : 'updated'} successfully`
      })
    } catch (error) {
      // Rollback transaction on error
      if (req.dbTransaction) {
        await req.dbTransaction.rollback()
      }
      logger.error(`Update appointment error: ${error.message}`)
      res.status(500).json({ 
        success: false, 
        error: "Failed to update appointment", 
        details: error.message,
        code: "UPDATE_ERROR"
      })
    }
  },

  // Get today's appointments for a doctor
  async getTodayAppointments(req, res) {
    try {
      const doctorId = req.user.id

      const query = `
        SELECT a.*, u.full_name AS patient_name, c.name AS clinic_name,
               s.start_time AS appointment_time, s.end_time AS appointment_end_time
        FROM appointments a
        JOIN users u ON a.patient_id = u.id
        LEFT JOIN clinics c ON a.clinic_id = c.id
        LEFT JOIN availability_slots s ON a.slot_id = s.id
        WHERE a.doctor_id = $1 
        AND (DATE(s.start_time) = CURRENT_DATE OR (s.start_time IS NULL AND DATE(a.created_at) = CURRENT_DATE))
        AND a.status IN ('booked', 'in-progress')
        ORDER BY COALESCE(s.start_time, a.created_at)
      `

      const result = await executeQuery(query, [doctorId])
      res.status(200).json({ success: true, data: result.rows })
    } catch (error) {
      logger.error(`Get today's appointments error: ${error.message}`)
      res.status(500).json({ success: false, error: "Server error", details: error.message })
    }
  },

  // Get clinic appointments (for clinic admins)
  async getClinicAppointments(req, res) {
    try {
      const { clinicId } = req.query
      const userRole = req.user.role

      if (!["clinic_admin", "platform_admin"].includes(userRole)) {
        return res.status(403).json({ error: "Access denied" })
      }

      let query = `
        SELECT a.*, u1.full_name AS patient_name, u2.full_name AS doctor_name,
               c.name AS clinic_name, s.start_time AS appointment_time,
               s.end_time AS appointment_end_time
        FROM appointments a
        JOIN users u1 ON a.patient_id = u1.id
        JOIN users u2 ON a.doctor_id = u2.id
        LEFT JOIN clinics c ON a.clinic_id = c.id
        LEFT JOIN availability_slots s ON a.slot_id = s.id
      `

      let params = []
      if (clinicId) {
        query += ` WHERE a.clinic_id = $1`
        params = [clinicId]
      }

      query += ` ORDER BY COALESCE(s.start_time, a.created_at) DESC`

      const result = await executeQuery(query, params)
      res.status(200).json({ success: true, data: result.rows })
    } catch (error) {
      logger.error(`Get clinic appointments error: ${error.message}`)
      res.status(500).json({ success: false, error: "Server error", details: error.message })
    }
  },

  // Get clinic appointment statistics
  async getClinicStats(req, res) {
    try {
      const { clinicId } = req.query

      let whereClause = ""
      let params = []

      if (clinicId) {
        whereClause = "WHERE a.clinic_id = $1"
        params = [clinicId]
      }

      const query = `
        SELECT 
          COUNT(*) as total_appointments,
          COUNT(CASE WHEN a.status = 'booked' THEN 1 END) as booked_appointments,
          COUNT(CASE WHEN a.status = 'completed' THEN 1 END) as completed_appointments,
          COUNT(CASE WHEN a.status = 'cancelled' THEN 1 END) as cancelled_appointments,
          COUNT(CASE WHEN DATE(COALESCE(s.start_time, a.created_at)) = CURRENT_DATE THEN 1 END) as today_appointments
        FROM appointments a
        LEFT JOIN availability_slots s ON a.slot_id = s.id
        ${whereClause}
      `

      const result = await executeQuery(query, params)
      res.status(200).json({ success: true, data: result.rows[0] })
    } catch (error) {
      logger.error(`Get clinic stats error: ${error.message}`)
      res.status(500).json({ success: false, error: "Server error", details: error.message })
    }
  },

  // Get clinic appointment statistics by clinic ID
  async getClinicStatsByClinicId(req, res) {
    try {
      const clinicId = req.params.id
      const userRole = req.user.role

      if (!["clinic_admin", "platform_admin"].includes(userRole)) {
        return res.status(403).json({ error: "Access denied" })
      }

      // Validate clinic ID
      if (isNaN(clinicId) || !Number.isInteger(Number(clinicId))) {
        return res.status(400).json({ error: "Invalid clinic ID format" })
      }

      logger.info(`Fetching stats for clinic ${clinicId}`)

      // Check if clinic exists
      const clinicExistsQuery = `SELECT id, name FROM clinics WHERE id = $1`
      const clinicResult = await executeQuery(clinicExistsQuery, [clinicId])

      if (clinicResult.rows.length === 0) {
        return res.status(404).json({ error: "Clinic not found" })
      }

      const clinic = clinicResult.rows[0]

      // Get comprehensive stats for the clinic
      const appointmentStatsQuery = `
        SELECT 
          COUNT(*) as total_appointments,
          COUNT(CASE WHEN a.status = 'booked' THEN 1 END) as booked_appointments,
          COUNT(CASE WHEN a.status = 'completed' THEN 1 END) as completed_appointments,
          COUNT(CASE WHEN a.status = 'cancelled' THEN 1 END) as cancelled_appointments,
          COUNT(CASE WHEN a.status = 'in-progress' THEN 1 END) as in_progress_appointments,
          COUNT(CASE WHEN DATE(COALESCE(s.start_time, a.created_at)) = CURRENT_DATE THEN 1 END) as today_appointments,
          COUNT(CASE WHEN DATE(COALESCE(s.start_time, a.created_at)) > CURRENT_DATE THEN 1 END) as upcoming_appointments,
          COUNT(DISTINCT a.patient_id) as total_patients,
          COUNT(CASE WHEN a.type = 'telemedicine' THEN 1 END) as telemedicine_appointments,
          COUNT(CASE WHEN a.type = 'in-person' THEN 1 END) as in_person_appointments
        FROM appointments a
        LEFT JOIN availability_slots s ON a.slot_id = s.id
        WHERE a.clinic_id = $1
      `

      const appointmentStatsResult = await executeQuery(appointmentStatsQuery, [clinicId])
      const appointmentStats = appointmentStatsResult.rows[0]

      // Get staff counts
      const staffCountsQuery = `
        SELECT 
          (SELECT COUNT(*) FROM doctor_clinics WHERE clinic_id = $1) as doctors,
          (SELECT COUNT(*) FROM nurse_clinics WHERE clinic_id = $1) as nurses,
          (SELECT COUNT(*) FROM lab_clinics WHERE clinic_id = $1) as labs,
          (SELECT COUNT(*) FROM admin_clinics WHERE clinic_id = $1) as admins
      `
      const staffCountsResult = await executeQuery(staffCountsQuery, [clinicId])
      const staffCounts = staffCountsResult.rows[0]
      const totalStaff = (parseInt(staffCounts.doctors) || 0) +
                         (parseInt(staffCounts.nurses) || 0) +
                         (parseInt(staffCounts.labs) || 0) +
                         (parseInt(staffCounts.admins) || 0)
      
      // Calculate revenue (use dynamic price)
      const revenuePerAppointment = parseFloat(clinic.appointment_price) || 0;
      const totalRevenue = (parseInt(appointmentStats.completed_appointments) || 0) * revenuePerAppointment;

      // Get monthly stats for the last 6 months
      const monthlyStatsQuery = `
        SELECT 
          TO_CHAR(COALESCE(s.start_time, a.created_at), 'Mon') as month,
          EXTRACT(MONTH FROM COALESCE(s.start_time, a.created_at)) as month_num,
          COUNT(*) as appointments,
          COUNT(DISTINCT a.patient_id) as patients
        FROM appointments a
        LEFT JOIN availability_slots s ON a.slot_id = s.id
        WHERE a.clinic_id = $1 
        AND COALESCE(s.start_time, a.created_at) >= CURRENT_DATE - INTERVAL '6 months'
        GROUP BY month_num, TO_CHAR(COALESCE(s.start_time, a.created_at), 'Mon')
        ORDER BY month_num
      `

      const monthlyResult = await executeQuery(monthlyStatsQuery, [clinicId])

      // Format the response
      const responseData = {
        clinic: {
          id: clinic.id,
          name: clinic.name,
        },
        totalStaff: totalStaff,
        totalRevenue: totalRevenue,
        totalPatients: Number.parseInt(appointmentStats.total_patients) || 0,
        totalAppointments: Number.parseInt(appointmentStats.total_appointments) || 0,
        todayAppointments: Number.parseInt(appointmentStats.today_appointments) || 0,
        upcomingAppointments: Number.parseInt(appointmentStats.upcoming_appointments) || 0,
        completedAppointments: Number.parseInt(appointmentStats.completed_appointments) || 0,
        cancelledAppointments: Number.parseInt(appointmentStats.cancelled_appointments) || 0,
        bookedAppointments: Number.parseInt(appointmentStats.booked_appointments) || 0,
        inProgressAppointments: Number.parseInt(appointmentStats.in_progress_appointments) || 0,
        telemedicineAppointments: Number.parseInt(appointmentStats.telemedicine_appointments) || 0,
        inPersonAppointments: Number.parseInt(appointmentStats.in_person_appointments) || 0,
        monthlyStats: monthlyResult.rows.map((row) => ({
          month: row.month,
          appointments: Number.parseInt(row.appointments) || 0,
          patients: Number.parseInt(row.patients) || 0,
        })),
      }

      logger.info(`Successfully retrieved stats for clinic ${clinicId}: ${appointmentStats.total_appointments} appointments`)
      res.status(200).json({ success: true, data: responseData })
    } catch (error) {
      logger.error(`Get clinic stats by ID error: ${error.message}`)
      res.status(500).json({ success: false, error: "Server error", details: error.message })
    }
  },

  // Start telemedicine session
  async startTelemedicineSession(req, res) {
    try {
      const appointmentId = req.params.id
      const userId = req.user.id

      // Check if appointment exists and user has access
      const appointmentQuery = `
        SELECT a.*, ts.id as session_id 
        FROM appointments a
        LEFT JOIN telemedicine_sessions ts ON a.id = ts.appointment_id
        WHERE a.id = $1 AND (a.patient_id = $2 OR a.doctor_id = $2)
      `
      const appointmentResult = await req.dbTransaction.query(appointmentQuery, [appointmentId, userId])

      if (appointmentResult.rows.length === 0) {
        await req.dbTransaction.rollback()
        return res.status(404).json({ error: "Appointment not found or access denied" })
      }

      const appointment = appointmentResult.rows[0]

      if (appointment.type !== "telemedicine") {
        await req.dbTransaction.rollback()
        return res.status(400).json({ error: "This is not a telemedicine appointment" })
      }

      // Update or create telemedicine session
      let sessionId = appointment.session_id

      if (!sessionId) {
        // Check available columns first
        const checkTelemedicineColumnsQuery = `
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'telemedicine_sessions'
          ORDER BY column_name
        `
        const columnsResult = await req.dbTransaction.query(checkTelemedicineColumnsQuery)
        const availableColumns = columnsResult.rows.map((row) => row.column_name)

        // Create new session based on available columns
        let createSessionQuery
        let sessionParams

        // Always use appointmentId as session id
        if (availableColumns.includes("patient_id") && availableColumns.includes("doctor_id")) {
          createSessionQuery = `
            INSERT INTO telemedicine_sessions 
            (id, appointment_id, patient_id, doctor_id, status, started_at)
            VALUES ($1, $1, $2, $3, $4, NOW())
            ON CONFLICT (id) DO NOTHING
            RETURNING id
          `
          sessionParams = [appointmentId, appointment.patient_id, appointment.doctor_id, "in-progress"]
        } else if (availableColumns.includes("doctor_id")) {
          createSessionQuery = `
            INSERT INTO telemedicine_sessions 
            (id, appointment_id, doctor_id, status, started_at)
            VALUES ($1, $1, $2, $3, NOW())
            ON CONFLICT (id) DO NOTHING
            RETURNING id
          `
          sessionParams = [appointmentId, appointment.doctor_id, "in-progress"]
        } else {
          createSessionQuery = `
            INSERT INTO telemedicine_sessions 
            (id, appointment_id, status, started_at)
            VALUES ($1, $1, $2, NOW())
            ON CONFLICT (id) DO NOTHING
            RETURNING id
          `
          sessionParams = [appointmentId, "in-progress"]
        }

        const sessionResult = await req.dbTransaction.query(createSessionQuery, sessionParams)
        sessionId = sessionResult.rows[0].id
      } else {
        // Update existing session
        await req.dbTransaction.query(
          "UPDATE telemedicine_sessions SET status = $1, started_at = NOW() WHERE id = $2",
          ["in-progress", sessionId],
        )
      }

      // Update appointment status
      await req.dbTransaction.query("UPDATE appointments SET status = $1 WHERE id = $2", ["in-progress", appointmentId])

      // Commit the transaction
      await req.dbTransaction.commit()

      res.status(200).json({ success: true, sessionId, message: "Telemedicine session started" })
    } catch (error) {
      // Rollback transaction on error
      if (req.dbTransaction) {
        await req.dbTransaction.rollback()
      }
      logger.error(`Start telemedicine session error: ${error.message}`)
      res.status(500).json({ success: false, error: "Server error", details: error.message })
    }
  },

  // End telemedicine session
  async endTelemedicineSession(req, res) {
    try {
      const appointmentId = req.params.id
      const { notes, sessionSummary } = req.body
      const userId = req.user.id

      // Check if appointment exists and user is the doctor
      const appointmentQuery = `
        SELECT a.*, ts.id as session_id 
        FROM appointments a
        LEFT JOIN telemedicine_sessions ts ON a.id = ts.appointment_id
        WHERE a.id = $1 AND a.doctor_id = $2
      `
      const appointmentResult = await req.dbTransaction.query(appointmentQuery, [appointmentId, userId])

      if (appointmentResult.rows.length === 0) {
        await req.dbTransaction.rollback()
        return res.status(404).json({ error: "Appointment not found or access denied" })
      }

      const appointment = appointmentResult.rows[0]

      // Update telemedicine session
      if (appointment.session_id) {
        const updateSessionQuery = `
          UPDATE telemedicine_sessions 
          SET status = $1, ended_at = NOW(), notes = $2, session_summary = $3
          WHERE id = $4
        `
        await req.dbTransaction.query(updateSessionQuery, ["completed", notes, sessionSummary, appointment.session_id])
      }

      // Update appointment status
      await req.dbTransaction.query("UPDATE appointments SET status = $1, notes = $2 WHERE id = $3", [
        "completed",
        notes,
        appointmentId,
      ])

      // Process completion payment
      let completionPaymentResult = null
      try {
        completionPaymentResult = await PaymentService.processCompletionPayment({
          appointmentId,
          patientId: appointment.patient_id,
          doctorId: appointment.doctor_id,
          appointmentType: appointment.type,
          dbTransaction: req.dbTransaction
        })
        
        console.log("Completion payment processed:", completionPaymentResult)
      } catch (paymentError) {
        console.error("Completion payment processing failed:", paymentError.message)
        // Don't fail the session end if payment fails, just log it
        logger.error(`Completion payment error for appointment ${appointmentId}: ${paymentError.message}`)
      }

      // Commit the transaction
      await req.dbTransaction.commit()

      res.status(200).json({ 
        success: true, 
        message: "Telemedicine session ended",
        paymentProcessed: completionPaymentResult?.paymentProcessed || false,
        paymentMessage: completionPaymentResult?.message
      })
    } catch (error) {
      // Rollback transaction on error
      if (req.dbTransaction) {
        await req.dbTransaction.rollback()
      }
      logger.error(`End telemedicine session error: ${error.message}`)
      res.status(500).json({ success: false, error: "Server error", details: error.message })
    }
  },

  // Check-in for appointment
  async checkIn(req, res) {
    try {
      const appointmentId = req.params.id
      const userId = req.user.id
      const userRole = req.user.role

      // Verify appointment exists and user has access
      let query = "SELECT * FROM appointments WHERE id = $1"
      const params = [appointmentId]

      if (userRole === "patient") {
        query += " AND patient_id = $2"
        params.push(userId)
      }

      const result = await req.dbTransaction.query(query, params)

      if (result.rows.length === 0) {
        await req.dbTransaction.rollback()
        return res.status(404).json({ error: "Appointment not found or access denied" })
      }

      // Update appointment with check-in time
      await req.dbTransaction.query("UPDATE appointments SET check_in_time = NOW(), status = $1 WHERE id = $2", [
        "in-progress",
        appointmentId,
      ])

      // Commit the transaction
      await req.dbTransaction.commit()

      res.status(200).json({ success: true, message: "Checked in successfully" })
    } catch (error) {
      // Rollback transaction on error
      if (req.dbTransaction) {
        await req.dbTransaction.rollback()
      }
      logger.error(`Check-in error: ${error.message}`)
      res.status(500).json({ success: false, error: "Server error", details: error.message })
    }
  },

  // Check-out for appointment
  async checkOut(req, res) {
    try {
      const appointmentId = req.params.id
      const { notes } = req.body
      const userId = req.user.id
      const userRole = req.user.role

      // Verify appointment exists and user has access
      let query = "SELECT * FROM appointments WHERE id = $1"
      const params = [appointmentId]

      if (userRole === "doctor") {
        query += " AND doctor_id = $2"
        params.push(userId)
      }

      const result = await req.dbTransaction.query(query, params)

      if (result.rows.length === 0) {
        await req.dbTransaction.rollback()
        return res.status(404).json({ error: "Appointment not found or access denied" })
      }

      const appointment = result.rows[0]

      // Update appointment with check-out time
      const updateQuery = `
        UPDATE appointments 
        SET check_out_time = NOW(), status = $1, notes = COALESCE($2, notes)
        WHERE id = $3
      `
      await req.dbTransaction.query(updateQuery, ["completed", notes, appointmentId])

      // Process completion payment
      let completionPaymentResult = null
      try {
        completionPaymentResult = await PaymentService.processCompletionPayment({
          appointmentId,
          patientId: appointment.patient_id,
          doctorId: appointment.doctor_id,
          appointmentType: appointment.type,
          dbTransaction: req.dbTransaction
        })
        
        console.log("Completion payment processed:", completionPaymentResult)
      } catch (paymentError) {
        console.error("Completion payment processing failed:", paymentError.message)
        // Don't fail the checkout if payment fails, just log it
        logger.error(`Completion payment error for appointment ${appointmentId}: ${paymentError.message}`)
      }

      // Commit the transaction
      await req.dbTransaction.commit()

      res.status(200).json({ 
        success: true, 
        message: "Checked out successfully",
        paymentProcessed: completionPaymentResult?.paymentProcessed || false,
        paymentMessage: completionPaymentResult?.message
      })
    } catch (error) {
      // Rollback transaction on error
      if (req.dbTransaction) {
        await req.dbTransaction.rollback()
      }
      logger.error(`Check-out error: ${error.message}`)
      res.status(500).json({ success: false, error: "Server error", details: error.message })
    }
  },

  // Cancel appointment
  async cancel(req, res) {
    try {
      const appointmentId = req.params.id
      const { reason = "Cancelled by user" } = req.body
      const userId = req.user.id
      const userRole = req.user.role

      // Check if appointment exists and user has access
      const appointmentQuery = `
        SELECT a.*, s.start_time, s.end_time
        FROM appointments a 
        LEFT JOIN availability_slots s ON a.slot_id = s.id 
        WHERE a.id = $1
      `
      const appointmentResult = await req.dbTransaction.query(appointmentQuery, [appointmentId])

      if (appointmentResult.rows.length === 0) {
        await req.dbTransaction.rollback()
        return res.status(404).json({ error: "Appointment not found" })
      }

      const appointment = appointmentResult.rows[0]

      // Check permissions
      if (userRole === "patient" && appointment.patient_id !== userId) {
        await req.dbTransaction.rollback()
        return res.status(403).json({ error: "Access denied - you can only cancel your own appointments" })
      }

      if (userRole === "doctor" && appointment.doctor_id !== userId) {
        await req.dbTransaction.rollback()
        return res.status(403).json({ error: "Access denied - you can only cancel your own appointments" })
      }

      // Update appointment status
      await req.dbTransaction.query("UPDATE appointments SET status = $1 WHERE id = $2", ["cancelled", appointmentId])

      // Make slot available again if it exists
      if (appointment.slot_id) {
        await req.dbTransaction.query("UPDATE availability_slots SET is_available = TRUE WHERE id = $1", [appointment.slot_id])
      }

      // Process refund if payment was made
      let refundResult = null
      try {
        refundResult = await PaymentService.processRefund({
        appointmentId,
          patientId: appointment.patient_id,
          reason,
          dbTransaction: req.dbTransaction
        })
        
        console.log("Refund processed:", refundResult)
      } catch (refundError) {
        console.error("Refund processing failed:", refundError.message)
        // Don't fail the cancellation if refund fails, just log it
        logger.error(`Refund error for appointment ${appointmentId}: ${refundError.message}`)
      }

      // Commit the transaction
      await req.dbTransaction.commit()

      res.status(200).json({ 
        success: true, 
        message: "Appointment cancelled successfully",
        refundProcessed: refundResult?.refundProcessed || false,
        refundMessage: refundResult?.message
      })
    } catch (error) {
      // Rollback transaction on error
      if (req.dbTransaction) {
        await req.dbTransaction.rollback()
      }
      logger.error(`Cancel appointment error: ${error.message}`)
      res.status(500).json({ success: false, error: "Server error", details: error.message })
    }
  },

  // Reschedule appointment
  async reschedule(req, res) {
    try {
      const appointmentId = req.params.id
      const { newDate, reason } = req.body
      const userId = req.user.id

      // Verify appointment exists and user has access
      const appointmentQuery = `
        SELECT a.*, s.start_time, s.end_time 
        FROM appointments a 
        LEFT JOIN availability_slots s ON a.slot_id = s.id 
        WHERE a.id = $1 AND (a.patient_id = $2 OR a.doctor_id = $2)
      `
      const appointmentResult = await req.dbTransaction.query(appointmentQuery, [appointmentId, userId])

      if (appointmentResult.rows.length === 0) {
        await req.dbTransaction.rollback()
        return res.status(404).json({ error: "Appointment not found or access denied" })
      }

      const appointment = appointmentResult.rows[0]
      const newAppointmentDate = new Date(newDate)

      // Calculate duration from existing slot or use default
      let duration = 30 // default 30 minutes
      if (appointment.start_time && appointment.end_time) {
        duration = (new Date(appointment.end_time) - new Date(appointment.start_time)) / (1000 * 60)
      }

      const newEndTime = new Date(newAppointmentDate.getTime() + duration * 60 * 1000)

      // Create new availability slot
      const createSlotQuery = `
  INSERT INTO availability_slots 
  (provider_id, provider_type, clinic_id, start_time, end_time, is_available)
  VALUES ($1, $2, $3, $4, $5, $6)
  RETURNING id
`
      const newSlotResult = await req.dbTransaction.query(createSlotQuery, [
        appointment.doctor_id,
        "doctor",
        appointment.clinic_id,
        formatDateForDB(newAppointmentDate),
        formatDateForDB(newEndTime),
        false, // Mark as unavailable since it's being used for the rescheduled appointment
      ])

      const newSlotId = newSlotResult.rows[0].id

      // Update appointment
      await req.dbTransaction.query(
        "UPDATE appointments SET slot_id = $1, notes = $2, updated_at = NOW() WHERE id = $3",
        [newSlotId, reason, appointmentId],
      )

      // Make old slot available if it exists
      if (appointment.slot_id) {
        console.log("=== SLOT RESCHEDULE DEBUG ===")
        console.log("Making old slot available due to reschedule:", appointment.slot_id)
        console.log("New slot created and marked unavailable:", newSlotId)

        const rescheduleUpdateResult = await req.dbTransaction.query(
          "UPDATE availability_slots SET is_available = TRUE WHERE id = $1 RETURNING id, is_available",
          [appointment.slot_id],
        )

        console.log("Reschedule update result:", rescheduleUpdateResult.rows[0])
        console.log("=== END SLOT RESCHEDULE ===")
      }

      // Commit the transaction
      await req.dbTransaction.commit()

      res.status(200).json({ success: true, message: "Appointment rescheduled successfully" })
    } catch (error) {
      // Rollback transaction on error
      if (req.dbTransaction) {
        await req.dbTransaction.rollback()
      }
      logger.error(`Reschedule appointment error: ${error.message}`)
      res.status(500).json({ success: false, error: "Server error", details: error.message })
    }
  },

  // Update appointment notes
  async updateNotes(req, res) {
    try {
      const appointmentId = req.params.id
      const { notes, diagnosis, treatment_plan, follow_up_required, follow_up_date } = req.body
      const userId = req.user.id
      const userRole = req.user.role

      console.log("Updating notes for appointment:", appointmentId, "by user:", userId, "role:", userRole)

      // Validate that appointmentId is a number
      if (isNaN(appointmentId) || !Number.isInteger(Number(appointmentId))) {
        logger.warn(`Invalid appointment ID format: ${appointmentId}`)
        return res.status(400).json({ success: false, error: "Invalid appointment ID format" })
      }

      // Check if user has permission to update this appointment
      const permissionQuery = `
      SELECT a.*, s.start_time 
      FROM appointments a 
      LEFT JOIN availability_slots s ON a.slot_id = s.id 
      WHERE a.id = $1
    `
      const permissionResult = await req.dbTransaction.query(permissionQuery, [appointmentId])

      if (permissionResult.rows.length === 0) {
        await req.dbTransaction.rollback()
        return res.status(404).json({ success: false, error: "Appointment not found" })
      }

      const appointment = permissionResult.rows[0]

      // Check permissions - only doctors can update notes, or the patient involved
      if (userRole === "doctor" && appointment.doctor_id !== userId) {
        await req.dbTransaction.rollback()
        return res.status(403).json({ success: false, error: "Access denied - not your appointment" })
      }

      if (userRole === "patient" && appointment.patient_id !== userId) {
        await req.dbTransaction.rollback()
        return res.status(403).json({ success: false, error: "Access denied - not your appointment" })
      }

      // First, check what columns actually exist in the appointments table
      const checkColumnsQuery = `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'appointments'
    `
      const columnsResult = await req.dbTransaction.query(checkColumnsQuery)
      const availableColumns = columnsResult.rows.map((row) => row.column_name)

      console.log("Available columns in appointments table:", availableColumns)

      // Build update query dynamically based on available columns
      const updates = []
      const params = []
      let paramCount = 1

      // Use appropriate column based on what's available
      if (notes !== undefined) {
        if (availableColumns.includes("clinical_notes")) {
          updates.push(`clinical_notes = $${paramCount}`)
          params.push(notes)
          paramCount++
        } else if (availableColumns.includes("notes")) {
          updates.push(`notes = $${paramCount}`)
          params.push(notes)
          paramCount++
        } else if (availableColumns.includes("reason")) {
          // Fallback to reason if neither clinical_notes nor notes exists
          updates.push(`reason = $${paramCount}`)
          params.push(notes)
          paramCount++
        }
      }

      if (diagnosis !== undefined && availableColumns.includes("diagnosis")) {
        updates.push(`diagnosis = $${paramCount}`)
        params.push(diagnosis)
        paramCount++
      }

      if (treatment_plan !== undefined && availableColumns.includes("treatment_plan")) {
        updates.push(`treatment_plan = $${paramCount}`)
        params.push(treatment_plan)
        paramCount++
      }

      if (follow_up_required !== undefined && availableColumns.includes("follow_up_required")) {
        updates.push(`follow_up_required = $${paramCount}`)
        params.push(follow_up_required)
        paramCount++
      }

      if (follow_up_date !== undefined && availableColumns.includes("follow_up_date")) {
        updates.push(`follow_up_date = $${paramCount}`)
        params.push(follow_up_date)
        paramCount++
      }

      if (updates.length === 0) {
        await req.dbTransaction.rollback()
        return res.status(400).json({
          success: false,
          error: "No valid fields to update",
          availableColumns: availableColumns,
        })
      }

      updates.push(`updated_at = NOW()`)
      params.push(appointmentId)

      const updateQuery = `
      UPDATE appointments 
      SET ${updates.join(", ")} 
      WHERE id = $${paramCount}
      RETURNING *
    `

      console.log("Executing update query:", updateQuery, "with params:", params)

      const result = await req.dbTransaction.query(updateQuery, params)

      // Commit the transaction
      await req.dbTransaction.commit()

      logger.info(`Appointment notes updated: ${appointmentId}`)
      res.status(200).json({
        success: true,
        data: result.rows[0],
        message: "Notes updated successfully",
      })
    } catch (error) {
      // Rollback transaction on error
      if (req.dbTransaction) {
        await req.dbTransaction.rollback()
      }
      logger.error(`Update appointment notes error: ${error.message}`)
      logger.error(`Query: ${error.query || "N/A"}`)
      logger.error(`Params: ${JSON.stringify(error.params || [])}`)
      res.status(500).json({ 
        success: false, 
        error: "Failed to update appointment notes", 
        details: error.message,
        code: "NOTES_UPDATE_ERROR"
      })
    }
  },
}

module.exports = AppointmentController
