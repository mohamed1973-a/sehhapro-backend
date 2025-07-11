const { v4: uuidv4 } = require("uuid")
const { pool } = require("../config/database")
const logger = require("../middleware/logger")
const NotificationController = require("../controllers/notificationController")
const { executeQuery } = require("../utils/dbUtils")
const asyncHandler = require("../utils/asyncHandler")
const { generateMeetingUrl } = require("../utils/jitsi")

class TelemedicineController {
  /**
   * Get all telemedicine sessions for the current user
   */
  static async getAll(req, res) {
    try {
      if (!req.user || !req.user.id || !req.user.role) {
        return res.status(401).json({ error: "Unauthorized: Missing or invalid user data" })
      }

      const role = req.user.role.toLowerCase()
      let query,
        params = []

      // Build query based on user role
      switch (role) {
        case "patient":
          query = `
            SELECT ts.*, a.reason, a.specialty,
                   u.full_name AS doctor_name,
                   s.start_time AS scheduled_time, s.end_time AS scheduled_end_time
            FROM telemedicine_sessions ts
            JOIN appointments a ON ts.appointment_id = a.id
            JOIN users u ON ts.doctor_id = u.id
            JOIN availability_slots s ON a.slot_id = s.id
            WHERE ts.patient_id = $1
            ORDER BY ts.scheduled_time DESC
          `
          params = [req.user.id]
          break

        case "doctor":
          query = `
            SELECT ts.*, a.reason, a.specialty,
                   u.full_name AS patient_name,
                   s.start_time AS scheduled_time, s.end_time AS scheduled_end_time
            FROM telemedicine_sessions ts
            JOIN appointments a ON ts.appointment_id = a.id
            JOIN users u ON ts.patient_id = u.id
            JOIN availability_slots s ON a.slot_id = s.id
            WHERE ts.doctor_id = $1
            ORDER BY ts.scheduled_time DESC
          `
          params = [req.user.id]
          break

        case "clinic_admin":
        case "platform_admin":
          query = `
            SELECT ts.*, a.reason, a.specialty,
                   u1.full_name AS patient_name, u2.full_name AS doctor_name,
                   s.start_time AS scheduled_time, s.end_time AS scheduled_end_time
            FROM telemedicine_sessions ts
            JOIN appointments a ON ts.appointment_id = a.id
            JOIN users u1 ON ts.patient_id = u1.id
            JOIN users u2 ON ts.doctor_id = u2.id
            JOIN availability_slots s ON a.slot_id = s.id
            ORDER BY ts.scheduled_time DESC
          `
          break

        default:
          return res.status(403).json({ error: "Forbidden: Invalid role for accessing telemedicine sessions" })
      }

      const result = await executeQuery(query, params)

      // Format the results
      const sessions = result.rows.map((session) => ({
        ...session,
        canStart:
          session.status === "scheduled" && new Date(session.scheduled_time) <= new Date(Date.now() + 15 * 60 * 1000), // 15 minutes before
        canJoin: session.status === "in-progress",
        formattedDate: new Date(session.scheduled_time).toLocaleDateString(),
        formattedTime: new Date(session.scheduled_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      }))

      res.status(200).json(sessions)
    } catch (err) {
      logger.error(`Get telemedicine sessions error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  /**
   * Get telemedicine session by ID
   */
  static async getById(req, res) {
    try {
      const { id } = req.params
      const userRole = req.user.role

      if (!req.user || !req.user.id) {
        return res.status(401).json({ error: "Unauthorized" })
      }

      let query, params

      switch (userRole) {
        case "patient":
          query = `
            SELECT ts.*, a.reason, a.specialty,
                   u1.full_name AS patient_name, u2.full_name AS doctor_name,
                   s.start_time AS appointment_time, s.end_time AS appointment_end_time
            FROM telemedicine_sessions ts
            JOIN appointments a ON ts.appointment_id = a.id
            JOIN users u1 ON ts.patient_id = u1.id
            JOIN users u2 ON ts.doctor_id = u2.id
            LEFT JOIN availability_slots s ON a.slot_id = s.id
            WHERE ts.id = $1 AND ts.patient_id = $2
          `
          params = [id, req.user.id]
          break

        case "doctor":
          query = `
            SELECT ts.*, a.reason, a.specialty,
                   u1.full_name AS patient_name, u2.full_name AS doctor_name,
                   s.start_time AS appointment_time, s.end_time AS appointment_end_time
            FROM telemedicine_sessions ts
            JOIN appointments a ON ts.appointment_id = a.id
            JOIN users u1 ON ts.patient_id = u1.id
            JOIN users u2 ON ts.doctor_id = u2.id
            LEFT JOIN availability_slots s ON a.slot_id = s.id
            WHERE ts.id = $1 AND ts.doctor_id = $2
          `
          params = [id, req.user.id]
          break

        case "platform_admin":
          query = `
            SELECT ts.*, a.reason, a.specialty,
                   u1.full_name AS patient_name, u2.full_name AS doctor_name,
                   s.start_time AS appointment_time, s.end_time AS appointment_end_time
            FROM telemedicine_sessions ts
            JOIN appointments a ON ts.appointment_id = a.id
            JOIN users u1 ON ts.patient_id = u1.id
            JOIN users u2 ON ts.doctor_id = u2.id
            LEFT JOIN availability_slots s ON a.slot_id = s.id
            WHERE ts.id = $1
          `
          params = [id]
          break

        default:
          return res.status(403).json({ 
            error: "Forbidden: Invalid role",
            message: "Access denied"
          })
      }

      const result = await executeQuery(query, params)

      if (result.rows.length === 0) {
        return res.status(404).json({ 
          error: "Telemedicine session not found or unauthorized",
          message: "Telemedicine session not found"
        })
      }

      const session = result.rows[0]

      // Add computed fields and timing validation
      const scheduledTime = new Date(session.scheduled_time || session.appointment_time)
      const now = new Date()
      const timeDiff = scheduledTime.getTime() - now.getTime()
      const minutesUntilAppointment = Math.floor(timeDiff / (1000 * 60))

      // More flexible timing validation
      const fifteenMinutesBefore = new Date(scheduledTime.getTime() - 15 * 60 * 1000)
      const twoHoursAfter = new Date(scheduledTime.getTime() + 2 * 60 * 60 * 1000)

      // Determine if session can be started/joined based on status and timing
      let canStart = false
      let canJoin = false

      if (session.status === "in-progress") {
        canJoin = true
        canStart = false // Already started
      } else if (session.status === "completed" || session.status === "cancelled") {
        canStart = false
        canJoin = false
      } else if (session.status === "scheduled") {
        // Allow starting/joining if within the flexible time window
        canStart = now >= fifteenMinutesBefore && now <= twoHoursAfter
        canJoin = session.status === "in-progress"
      } else {
        // For any other status, allow joining
        canJoin = session.status === "in-progress"
        canStart = false
      }

      session.canStart = canStart
      session.canJoin = canJoin
      session.formattedDate = scheduledTime.toLocaleDateString()
      session.formattedTime = scheduledTime.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })
      
      // Add timing information
      session.appointmentTime = scheduledTime.toISOString()
      session.currentTime = now.toISOString()
      session.timeDiff = timeDiff
      session.minutesUntilAppointment = minutesUntilAppointment
      session.isExpired = now > twoHoursAfter // Only expired if more than 2 hours after
      session.isTooEarly = now < fifteenMinutesBefore

      res.status(200).json(session)
    } catch (err) {
      logger.error(`Get telemedicine session by ID error: ${err.message}`)
      res.status(500).json({ 
        error: "Server error", 
        details: err.message,
        message: "Failed to load session"
      })
    }
  }

  /**
   * Create standalone telemedicine session (deprecated - use appointments API)
   */
  static async createStandalone(req, res) {
    try {
      // This method is deprecated in favor of unified appointment creation
      return res.status(400).json({
        error: "Deprecated: Use /api/appointments with type='telemedicine' instead",
        redirectTo: "/api/appointments",
      })
    } catch (err) {
      logger.error(`Create standalone telemedicine session error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  /**
   * Update telemedicine session
   */
  static async update(req, res) {
    try {
      const { id } = req.params
      const { status, notes, sessionSummary } = req.body

      if (!req.user || !req.user.id) {
        return res.status(401).json({ error: "Unauthorized" })
      }

      // Check if user has permission to update this session
      const sessionCheck = await executeQuery(
        "SELECT * FROM telemedicine_sessions WHERE id = $1 AND (patient_id = $2 OR doctor_id = $2)",
        [id, req.user.id],
      )

      if (sessionCheck.rows.length === 0) {
        return res.status(404).json({ error: "Session not found or unauthorized" })
      }

      // Build update query
      const updateFields = ["updated_at = NOW()"]
      const updateParams = []
      let paramIndex = 1

      if (status) {
        updateFields.push(`status = $${paramIndex}`)
        updateParams.push(status)
        paramIndex++
      }

      if (notes) {
        updateFields.push(`notes = $${paramIndex}`)
        updateParams.push(notes)
        paramIndex++
      }

      if (sessionSummary) {
        updateFields.push(`session_summary = $${paramIndex}`)
        updateParams.push(sessionSummary)
        paramIndex++
      }

      updateParams.push(id)

      const result = await executeQuery(
        `UPDATE telemedicine_sessions SET ${updateFields.join(", ")} WHERE id = $${paramIndex} RETURNING *`,
        updateParams,
      )

      res.status(200).json({
        message: "Session updated successfully",
        session: result.rows[0],
      })
    } catch (err) {
      logger.error(`Update telemedicine session error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  /**
   * Start a telemedicine session.
   * This is typically called by the doctor.
   * It generates the meeting URL and moves the status to 'in-progress'.
   */
  static async start(req, res) {
    try {
      const { id } = req.params
      const userId = req.user.id
      const userRole = req.user.role

      // 1. Fetch the session and verify permissions
      const sessionResult = await executeQuery(
        `SELECT ts.*, a.doctor_id, a.patient_id 
         FROM telemedicine_sessions ts
         JOIN appointments a ON ts.appointment_id = a.id
         WHERE ts.id = $1`,
        [id],
      )

      if (sessionResult.rows.length === 0) {
        return res.status(404).json({ message: "Telemedicine session not found." })
      }

      const session = sessionResult.rows[0]

      // Only the assigned doctor can start the session
      if (userRole !== "doctor" || session.doctor_id !== userId) {
        return res.status(403).json({ message: "You are not authorized to start this session." })
      }

      // 2. Check session status
      if (session.status !== "scheduled") {
        // If already in-progress, return existing URL
        if (session.status === "in-progress" && session.session_url) {
          return res.status(200).json({
            message: "Session already in progress.",
            meetingUrl: session.session_url,
            session,
          })
        }
        return res.status(400).json({ message: `Cannot start a session with status: ${session.status}` })
      }

      // 3. Generate Jitsi meeting URL
      const meetingUrl = generateMeetingUrl()

      // 4. Update the session in the database
      const updateResult = await executeQuery(
        `UPDATE telemedicine_sessions 
         SET status = 'in-progress', session_url = $1, start_time = NOW(), updated_at = NOW() 
         WHERE id = $2
         RETURNING *`,
        [meetingUrl, id],
      )

      const updatedSession = updateResult.rows[0]

      // 5. Send notifications (optional but recommended)
      // Notify patient that the doctor has started the session
      await NotificationController.createNotification({
        userId: session.patient_id,
        message: `Your telemedicine session with Dr. ${req.user.full_name} has started.`,
        type: "session_started",
        priority: "high",
        refId: updatedSession.id,
      })

      // 6. Return the meeting URL to the frontend
      res.status(200).json({
        message: "Telemedicine session started successfully.",
        meetingUrl: meetingUrl,
        session: updatedSession,
      })
    } catch (err) {
      logger.error(`Start telemedicine session error: ${err.message}`)
      res.status(500).json({ message: "Failed to start telemedicine session.", details: err.message })
    }
  }

  /**
   * End a telemedicine session.
   */
  static async end(req, res) {
    try {
      const { id } = req.params
      const { notes, sessionSummary } = req.body

      if (!req.user || !req.user.id) {
        return res.status(401).json({ error: "Unauthorized" })
      }

      // Get session details (only doctors can end sessions)
      const result = await executeQuery(
        `SELECT ts.*, a.status as appointment_status 
         FROM telemedicine_sessions ts 
         JOIN appointments a ON ts.appointment_id = a.id 
         WHERE ts.id = $1 AND ts.doctor_id = $2`,
        [id, req.user.id],
      )

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Session not found or unauthorized" })
      }

      const session = result.rows[0]

      if (session.status !== "in-progress") {
        return res.status(400).json({ error: "No active session to end" })
      }

      // End the session
      await executeQuery(
        `UPDATE telemedicine_sessions 
         SET status = 'completed', end_time = NOW(), notes = $1, session_summary = $2 
         WHERE id = $3`,
        [notes || null, sessionSummary || null, id],
      )

      // Update appointment status
      await executeQuery("UPDATE appointments SET status = 'completed', notes = $1 WHERE id = $2", [
        notes || null,
        session.appointment_id,
      ])

      // Notify patient
      try {
        await NotificationController.createNotification({
          userId: session.patient_id,
          message: `Telemedicine session #${id} has ended`,
          type: "session_ended",
          priority: "normal",
          refId: id,
        })
      } catch (notifyError) {
        logger.error(`Failed to send session end notification: ${notifyError.message}`)
      }

      res.status(200).json({
        message: "Session ended successfully",
        session: {
          id: session.id,
          status: "completed",
          appointmentId: session.appointment_id,
          notes: notes || null,
          sessionSummary: sessionSummary || null,
        },
      })
    } catch (err) {
      logger.error(`End telemedicine session error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  /**
   * Join a telemedicine session.
   * This is used by both doctor and patient after the session has been started.
   */
  static async join(req, res) {
    try {
      const { id } = req.params
      const userId = req.user.id
      const userRole = req.user.role

      // 1. Fetch the session
      const sessionResult = await executeQuery(
        `SELECT ts.*, a.doctor_id, a.patient_id
         FROM telemedicine_sessions ts
         JOIN appointments a ON ts.appointment_id = a.id
         WHERE ts.id = $1`,
        [id],
      )

      if (sessionResult.rows.length === 0) {
        return res.status(404).json({ message: "Telemedicine session not found." })
      }

      const session = sessionResult.rows[0]

      // 2. Verify permissions
      const isDoctor = userRole === "doctor" && session.doctor_id === userId
      const isPatient = userRole === "patient" && session.patient_id === userId

      if (!isDoctor && !isPatient) {
        return res.status(403).json({ message: "You are not authorized to join this session." })
      }

      // 3. Check session status and URL
      if (session.status !== "in-progress") {
        return res.status(400).json({ message: "This session is not active. It cannot be joined." })
      }

      if (!session.session_url) {
        return res.status(404).json({ message: "Meeting URL not found for this session. The session may not have been started correctly." })
      }

      // 4. Return the meeting URL
      res.status(200).json({
        message: "Successfully retrieved session details.",
        meetingUrl: session.session_url,
        session,
      })
    } catch (err) {
      logger.error(`Join telemedicine session error: ${err.message}`)
      res.status(500).json({ message: "Failed to join telemedicine session.", details: err.message })
    }
  }

  /**
   * Leave a telemedicine session (placeholder).
   */
  static async leave(req, res) {
    try {
      const { id } = req.params

      if (!req.user || !req.user.id) {
        return res.status(401).json({ error: "Unauthorized" })
      }

      // For now, just acknowledge the leave request
      // In a real implementation, you might update participant status
      res.status(200).json({
        message: "Left session successfully",
        sessionId: id,
      })
    } catch (err) {
      logger.error(`Leave telemedicine session error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  /**
   * Get session messages
   */
  static async getMessages(req, res) {
    try {
      const { id } = req.params

      if (!req.user || !req.user.id) {
        return res.status(401).json({ error: "Unauthorized" })
      }

      // Check if user has access to this session
      const sessionCheck = await executeQuery(
        "SELECT 1 FROM telemedicine_sessions WHERE id = $1 AND (patient_id = $2 OR doctor_id = $2)",
        [id, req.user.id],
      )

      if (sessionCheck.rows.length === 0) {
        return res.status(404).json({ error: "Session not found or unauthorized" })
      }

      // Get messages (if you have a messages table)
      // For now, return empty array as messages table is not in the schema
      res.status(200).json([])
    } catch (err) {
      logger.error(`Get session messages error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  /**
   * Send message in session
   */
  static async sendMessage(req, res) {
    try {
      const { id } = req.params
      const { message, type = "text" } = req.body

      if (!req.user || !req.user.id) {
        return res.status(401).json({ error: "Unauthorized" })
      }

      // Check if user has access to this session
      const sessionCheck = await executeQuery(
        "SELECT * FROM telemedicine_sessions WHERE id = $1 AND (patient_id = $2 OR doctor_id = $2)",
        [id, req.user.id],
      )

      if (sessionCheck.rows.length === 0) {
        return res.status(404).json({ error: "Session not found or unauthorized" })
      }

      const session = sessionCheck.rows[0]

      if (session.status !== "in-progress") {
        return res.status(400).json({ error: "Can only send messages during active sessions" })
      }

      // For now, just acknowledge the message
      // In a real implementation, you would store this in a messages table
      res.status(200).json({
        message: "Message sent successfully",
        messageData: {
          id: Date.now(),
          sessionId: id,
          senderId: req.user.id,
          message,
          type,
          timestamp: new Date().toISOString(),
        },
      })
    } catch (err) {
      logger.error(`Send session message error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  static async schedule(req, res) {
    const { specialty, date, reason } = req.body
    if (!specialty || !date) return res.status(400).json({ error: "Specialty and date required" })

    console.log("Scheduling telemedicine session:", { specialty, date, reason, patientId: req.user.id })

    try {
      await pool.query("BEGIN")

      // Find available doctors with the specified specialty
      const doctorQuery = `
    SELECT u.id AS doctor_id, dp.doctor_id, dc.clinic_id, 
           dp.years_experience,
           COALESCE((SELECT AVG(rating) FROM doctor_feedback WHERE doctor_id = u.id), 0) AS avg_rating,
           (SELECT COUNT(*) FROM appointments 
            WHERE doctor_id = u.id 
            AND status = 'booked' 
            AND created_at > NOW() - INTERVAL '7 days') AS recent_appointments
    FROM users u
    JOIN doctor_portfolios dp ON u.id = dp.doctor_id
    JOIN doctor_clinics dc ON u.id = dc.doctor_id
    WHERE dp.specialty = $1 
    AND dp.available_for_telemedicine = TRUE
    ORDER BY 
      -- First prioritize by rating
      avg_rating DESC,
      -- Then by experience
      years_experience DESC,
      -- Then by workload (fewer recent appointments is better)
      recent_appointments ASC,
      -- Finally add some randomness for equal candidates
      RANDOM()
    LIMIT 1
  `
      const doctorResult = await pool.query(doctorQuery, [specialty])

      if (doctorResult.rows.length === 0) {
        // Try to find any doctor with telemedicine availability
        const anyDoctorQuery = `
      SELECT u.id AS doctor_id, dc.clinic_id
      FROM users u
      JOIN doctor_portfolios dp ON u.id = dp.doctor_id
      JOIN doctor_clinics dc ON u.id = dc.doctor_id
      WHERE dp.available_for_telemedicine = TRUE
      ORDER BY RANDOM()
      LIMIT 1
    `

        const anyDoctorResult = await pool.query(anyDoctorQuery)

        if (anyDoctorResult.rows.length === 0) {
          await pool.query("ROLLBACK")
          return res.status(404).json({ error: `No doctors available for telemedicine at this time` })
        }

        const doctorId = anyDoctorResult.rows[0].doctor_id
        const clinicId = anyDoctorResult.rows[0].clinic_id

        console.log(`No doctors found for specialty ${specialty}, using available doctor ${doctorId} instead`)

        // Create a new slot for this doctor
        const requestedDate = new Date(date)
        // Ensure we're using the exact time provided without timezone adjustments
        const slotEndTime = new Date(requestedDate.getTime())
        slotEndTime.setMinutes(slotEndTime.getMinutes() + 30) // 30-minute slot

        // Create a new availability slot
        const newSlotResult = await pool.query(
          `INSERT INTO availability_slots 
       (provider_id, provider_type, clinic_id, start_time, end_time, is_available) 
       VALUES ($1, $2, $3, $4, $5, TRUE) 
       RETURNING id, start_time, end_time`,
          [doctorId, "doctor", clinicId, requestedDate.toISOString(), slotEndTime.toISOString()],
        )

        const slotId = newSlotResult.rows[0].id

        // Mark slot as unavailable
        await pool.query("UPDATE availability_slots SET is_available = FALSE WHERE id = $1", [slotId])

        // Create appointment
        const appointmentResult = await pool.query(
          "INSERT INTO appointments (patient_id, doctor_id, clinic_id, slot_id, type, reason, status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
          [req.user.id, doctorId, clinicId, slotId, "telemedicine", reason, "booked"],
        )

        const appointmentId = appointmentResult.rows[0].id

        const roomName = `Teleconsult_${uuidv4()}`
        const videoLink = `https://meet.jit.si/${roomName}`
        const sessionResult = await pool.query(
          "INSERT INTO telemedicine_sessions (appointment_id, start_time, video_link, status) VALUES ($1, $2, $3, 'scheduled') RETURNING *",
          [appointmentId, requestedDate.toISOString(), videoLink],
        )

        // Get doctor name for response
        const doctorNameResult = await pool.query("SELECT full_name FROM users WHERE id = $1", [doctorId])
        const doctorName = doctorNameResult.rows[0]?.full_name || "Unknown Doctor"

        // Get clinic name
        const clinicResult = await pool.query("SELECT name FROM clinics WHERE id = $1", [clinicId])
        const clinicName = clinicResult.rows[0]?.name || "Unknown Clinic"

        // Send notifications
        const formattedDate = new Date(requestedDate).toLocaleString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })

        await NotificationController.createNotification({
          userId: req.user.id,
          message: `Your telemedicine appointment with Dr. ${doctorName} has been scheduled for ${formattedDate}. Please log in 5 minutes before your appointment time.`,
          type: "appointment_scheduled",
          priority: "high",
          sendSms: true,
          refId: appointmentId,
        })

        await NotificationController.createNotification({
          userId: doctorId,
          message: `New telemedicine appointment scheduled with a patient for ${formattedDate}.`,
          type: "appointment_scheduled",
          sendSms: true,
          refId: appointmentId,
        })

        await pool.query("COMMIT")

        const session = {
          ...sessionResult.rows[0],
          doctor_name: doctorName,
          doctor_id: doctorId,
          clinic_name: clinicName,
        }

        return res.status(201).json({
          message: `Teleconsultation scheduled with ${doctorName} for ${formattedDate}`,
          session: session,
        })
      }

      const doctorId = doctorResult.rows[0].doctor_id
      const clinicId = doctorResult.rows[0].clinic_id

      console.log(
        `Selected doctor ${doctorId} with specialty ${specialty} at clinic ${clinicId} based on rating, experience, and current workload`,
      )

      // Check slot availability for the selected doctor
      const slotCheck = await pool.query(
        "SELECT id FROM availability_slots WHERE provider_id = $1 AND provider_type = 'doctor' AND clinic_id = $2 AND start_time = $3 AND is_available = TRUE",
        [doctorId, clinicId, date],
      )

      if (slotCheck.rows.length === 0) {
        // If no slot exists for the exact time, find the next available slot
        const nextSlotQuery = `
      SELECT id, start_time 
      FROM availability_slots 
      WHERE provider_id = $1 
      AND provider_type = 'doctor'
      AND clinic_id = $2 
      AND start_time > $3 
      AND is_available = TRUE 
      ORDER BY start_time 
      LIMIT 1
    `
        const nextSlotResult = await pool.query(nextSlotQuery, [doctorId, clinicId, date])

        if (nextSlotResult.rows.length === 0) {
          // Create a new slot if none is available
          const requestedDate = new Date(date)
          // Ensure we're using the exact time provided without timezone adjustments
          const slotEndTime = new Date(requestedDate.getTime())
          slotEndTime.setMinutes(slotEndTime.getMinutes() + 30) // 30-minute slot

          // Create a new availability slot
          const newSlotResult = await pool.query(
            `INSERT INTO availability_slots 
         (provider_id, provider_type, clinic_id, start_time, end_time, is_available) 
         VALUES ($1, $2, $3, $4, $5, TRUE) 
         RETURNING id, start_time, end_time`,
            [doctorId, "doctor", clinicId, requestedDate.toISOString(), slotEndTime.toISOString()],
          )

          const slotId = newSlotResult.rows[0].id
          const actualDate = newSlotResult.rows[0].start_time

          // Mark slot as unavailable
          await pool.query("UPDATE availability_slots SET is_available = FALSE WHERE id = $1", [slotId])

          // Create appointment
          const appointmentResult = await pool.query(
            "INSERT INTO appointments (patient_id, doctor_id, clinic_id, slot_id, type, reason, status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
            [req.user.id, doctorId, clinicId, slotId, "telemedicine", reason, "booked"],
          )

          const appointmentId = appointmentResult.rows[0].id

          const roomName = `Teleconsult_${uuidv4()}`
          const videoLink = `https://meet.jit.si/${roomName}`
          const sessionResult = await pool.query(
            "INSERT INTO telemedicine_sessions (appointment_id, start_time, video_link, status) VALUES ($1, $2, $3, 'scheduled') RETURNING *",
            [appointmentId, actualDate, videoLink],
          )

          // Get doctor name for response
          const doctorNameResult = await pool.query("SELECT full_name FROM users WHERE id = $1", [doctorId])
          const doctorName = doctorNameResult.rows[0]?.full_name || "Unknown Doctor"

          // Get clinic name
          const clinicResult = await pool.query("SELECT name FROM clinics WHERE id = $1", [clinicId])
          const clinicName = clinicResult.rows[0]?.name || "Unknown Clinic"

          // Send notifications
          const formattedDate = new Date(actualDate).toLocaleString("en-US", {
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          })

          await NotificationController.createNotification({
            userId: req.user.id,
            message: `Your telemedicine appointment with Dr. ${doctorName} (${specialty}) has been scheduled for ${formattedDate}. Please log in 5 minutes before your appointment time.`,
            type: "appointment_scheduled",
            priority: "high",
            sendSms: true,
            refId: appointmentId,
          })

          await NotificationController.createNotification({
            userId: doctorId,
            message: `New telemedicine appointment scheduled with a patient for ${formattedDate}.`,
            type: "appointment_scheduled",
            sendSms: true,
            refId: appointmentId,
          })

          await pool.query("COMMIT")
          logger.info(`Teleconsultation scheduled for patient: ${req.user.id} with doctor: ${doctorId}`)

          const session = {
            ...sessionResult.rows[0],
            doctor_name: doctorName,
            doctor_id: doctorId,
            clinic_name: clinicName,
            actual_date: actualDate,
          }

          res.status(201).json({
            message: `Teleconsultation scheduled with ${doctorName} at ${formattedDate}`,
            session: session,
          })
        }

        // Use the next available slot
        const slotId = nextSlotResult.rows[0].id
        const actualDate = nextSlotResult.rows[0].start_time

        // Mark slot as unavailable
        await pool.query("UPDATE availability_slots SET is_available = FALSE WHERE id = $1", [slotId])

        // Create appointment
        const appointmentResult = await pool.query(
          "INSERT INTO appointments (patient_id, doctor_id, clinic_id, slot_id, type, reason, status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
          [req.user.id, doctorId, clinicId, slotId, "telemedicine", reason, "booked"],
        )

        const appointmentId = appointmentResult.rows[0].id
        console.log("Created appointment with ID:", appointmentId)

        const roomName = `Teleconsult_${uuidv4()}`
        const videoLink = `https://meet.jit.si/${roomName}`
        const sessionResult = await pool.query(
          "INSERT INTO telemedicine_sessions (appointment_id, start_time, video_link, status) VALUES ($1, $2, $3, 'scheduled') RETURNING *",
          [appointmentId, actualDate, videoLink],
        )

        // Get doctor name for response
        const doctorNameResult = await pool.query("SELECT full_name FROM users WHERE id = $1", [doctorId])
        const doctorName = doctorNameResult.rows[0]?.full_name || "Unknown Doctor"

        // Get clinic name
        const clinicResult = await pool.query("SELECT name FROM clinics WHERE id = $1", [clinicId])
        const clinicName = clinicResult.rows[0]?.name || "Unknown Clinic"

        // Send notification to patient
        const formattedDate = new Date(actualDate).toLocaleString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })

        await NotificationController.createNotification({
          userId: req.user.id,
          message: `Your telemedicine appointment with Dr. ${doctorName} (${specialty}) has been scheduled for ${formattedDate}. Please log in 5 minutes before your appointment time.`,
          type: "appointment_scheduled",
          priority: "high",
          sendSms: true,
          refId: appointmentId,
        })

        // Also notify the doctor
        await NotificationController.createNotification({
          userId: doctorId,
          message: `New telemedicine appointment scheduled with a patient for ${formattedDate}.`,
          type: "appointment_scheduled",
          sendSms: true,
          refId: appointmentId,
        })

        await pool.query("COMMIT")
        logger.info(`Teleconsultation scheduled for patient: ${req.user.id} with doctor: ${doctorId}`)

        const session = {
          ...sessionResult.rows[0],
          doctor_name: doctorName,
          doctor_id: doctorId,
          clinic_name: clinicName,
          actual_date: actualDate,
        }

        res.status(201).json({
          message: `Teleconsultation scheduled with ${doctorName} at ${formattedDate}`,
          session: session,
        })
      } else {
        // Use the exact time slot
        const slotId = slotCheck.rows[0].id

        // Mark slot as unavailable
        await pool.query("UPDATE availability_slots SET is_available = FALSE WHERE id = $1", [slotId])

        // Create appointment
        const appointmentResult = await pool.query(
          "INSERT INTO appointments (patient_id, doctor_id, clinic_id, slot_id, type, reason, status) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
          [req.user.id, doctorId, clinicId, slotId, "telemedicine", reason, "booked"],
        )

        const appointmentId = appointmentResult.rows[0].id
        console.log("Created appointment with ID:", appointmentId)

        const roomName = `Teleconsult_${uuidv4()}`
        const videoLink = `https://meet.jit.si/${roomName}`
        const sessionResult = await pool.query(
          "INSERT INTO telemedicine_sessions (appointment_id, start_time, video_link, status) VALUES ($1, $2, $3, 'scheduled') RETURNING *",
          [appointmentId, date, videoLink],
        )

        // Get doctor name for response
        const doctorNameResult = await pool.query("SELECT full_name FROM users WHERE id = $1", [doctorId])
        const doctorName = doctorNameResult.rows[0]?.full_name || "Unknown Doctor"

        // Get clinic name
        const clinicResult = await pool.query("SELECT name FROM clinics WHERE id = $1", [clinicId])
        const clinicName = clinicResult.rows[0]?.name || "Unknown Clinic"

        // Send notification to patient
        const formattedDate = new Date(date).toLocaleString("en-US", {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })

        await NotificationController.createNotification({
          userId: req.user.id,
          message: `Your telemedicine appointment with Dr. ${doctorName} (${specialty}) has been scheduled for ${formattedDate}. Please log in 5 minutes before your appointment time.`,
          type: "appointment_scheduled",
          priority: "high",
          sendSms: true,
          refId: appointmentId,
        })

        // Also notify the doctor
        await NotificationController.createNotification({
          userId: doctorId,
          message: `New telemedicine appointment scheduled with a patient for ${formattedDate}.`,
          type: "appointment_scheduled",
          sendSms: true,
          refId: appointmentId,
        })

        await pool.query("COMMIT")
        logger.info(`Teleconsultation scheduled for patient: ${req.user.id} with doctor: ${doctorId}`)

        const session = {
          ...sessionResult.rows[0],
          doctor_name: doctorName,
          doctor_id: doctorId,
          clinic_name: clinicName,
        }

        res.status(201).json({
          message: `Teleconsultation scheduled with ${doctorName} for ${formattedDate}`,
          session: session,
        })
      }
    } catch (err) {
      await pool.query("ROLLBACK")
      console.error("Schedule telemedicine error details:", err.message, err.stack)
      logger.error(`Schedule telemedicine error: ${err.message}`)
      if (err.code === "23505") return res.status(400).json({ error: "Time slot already booked" })
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  static async getAll(req, res) {
    try {
      let query, params

      if (req.user.role === "patient") {
        query = `
          SELECT ts.*, a.doctor_id, u.full_name AS doctor_name, 
                 c.name AS clinic_name, a.status AS appointment_status
          FROM telemedicine_sessions ts 
          JOIN appointments a ON ts.appointment_id = a.id 
          JOIN users u ON a.doctor_id = u.id
          JOIN clinics c ON a.clinic_id = c.id
          WHERE a.patient_id = $1 
          ORDER BY ts.start_time DESC
        `
        params = [req.user.id]
      } else if (req.user.role === "doctor") {
        query = `
          SELECT ts.*, a.patient_id, u.full_name AS patient_name, 
                 c.name AS clinic_name, a.status AS appointment_status
          FROM telemedicine_sessions ts 
          JOIN appointments a ON ts.appointment_id = a.id 
          JOIN users u ON a.patient_id = u.id
          JOIN clinics c ON a.clinic_id = c.id
          WHERE a.doctor_id = $1 
          ORDER BY ts.start_time DESC
        `
        params = [req.user.id]
      } else if (req.user.role === "clinic_admin") {
        query = `
          SELECT ts.*, a.patient_id, a.doctor_id, 
                 u1.full_name AS patient_name, u2.full_name AS doctor_name, 
                 c.name AS clinic_name, a.status AS appointment_status
          FROM telemedicine_sessions ts 
          JOIN appointments a ON ts.appointment_id = a.id 
          JOIN users u1 ON a.patient_id = u1.id 
          JOIN users u2 ON a.doctor_id = u2.id
          JOIN clinics c ON a.clinic_id = c.id
          ORDER BY ts.start_time DESC
        `
        params = []
      } else {
        return res.status(403).json({ error: "Unauthorized role for accessing telemedicine sessions" })
      }

      const result = await pool.query(query, params)
      res.json(result.rows)
    } catch (err) {
      logger.error(`Get teleconsultations error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  static async getById(req, res) {
    const { id } = req.params

    try {
      // Get session with appointment details
      const query = `
        SELECT ts.*, a.patient_id, a.doctor_id, a.clinic_id,
               u1.full_name AS patient_name, u2.full_name AS doctor_name,
               c.name AS clinic_name, a.status AS appointment_status
        FROM telemedicine_sessions ts
        JOIN appointments a ON ts.appointment_id = a.id
        JOIN users u1 ON a.patient_id = u1.id
        JOIN users u2 ON a.doctor_id = u2.id
        JOIN clinics c ON a.clinic_id = c.id
        WHERE ts.id = $1
      `

      const result = await pool.query(query, [id])

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Telemedicine session not found" })
      }

      const session = result.rows[0]

      // Check authorization
      if (req.user.role === "patient" && session.patient_id !== req.user.id) {
        return res.status(403).json({ error: "Not authorized to view this session" })
      }

      if (req.user.role === "doctor" && session.doctor_id !== req.user.id) {
        return res.status(403).json({ error: "Not authorized to view this session" })
      }

      res.json(session)
    } catch (err) {
      logger.error(`Get telemedicine session error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  static async update(req, res) {
    const { id } = req.params
    const { status, notes } = req.body

    try {
      await pool.query("BEGIN")

      // Validate status if provided
      if (status && !["scheduled", "in-progress", "completed", "cancelled"].includes(status)) {
        await pool.query("ROLLBACK")
        return res.status(400).json({ error: "Invalid status value" })
      }

      // Get session with appointment details
      const sessionCheck = await pool.query(
        `SELECT ts.*, a.patient_id, a.doctor_id, a.id AS appointment_id
         FROM telemedicine_sessions ts
         JOIN appointments a ON ts.appointment_id = a.id
         WHERE ts.id = $1`,
        [id],
      )

      if (sessionCheck.rows.length === 0) {
        await pool.query("ROLLBACK")
        return res.status(404).json({ error: "Telemedicine session not found" })
      }

      const session = sessionCheck.rows[0]

      // Check authorization
      if (req.user.role === "doctor" && session.doctor_id !== req.user.id) {
        await pool.query("ROLLBACK")
        return res.status(403).json({ error: "Not authorized to update this session" })
      }

      if (req.user.role === "patient" && session.patient_id !== req.user.id) {
        await pool.query("ROLLBACK")
        return res.status(403).json({ error: "Not authorized to update this session" })
      }

      // Patients can only cancel sessions
      if (req.user.role === "patient" && status && status !== "cancelled") {
        await pool.query("ROLLBACK")
        return res.status(403).json({ error: "Patients can only cancel sessions" })
      }

      const result = await pool.query(
        `UPDATE telemedicine_sessions 
         SET status = COALESCE($1, status), 
             notes = COALESCE($2, notes), 
             updated_at = NOW() 
         WHERE id = $3 
         RETURNING *`,
        [status, notes, id],
      )

      // Update appointment status if session status changes
      if (status) {
        await pool.query("UPDATE appointments SET status = $1 WHERE id = $2", [status, session.appointment_id])

        // If cancelled, make the slot available again
        if (status === "cancelled") {
          const appointmentResult = await pool.query("SELECT slot_id FROM appointments WHERE id = $1", [
            session.appointment_id,
          ])

          if (appointmentResult.rows.length > 0 && appointmentResult.rows[0].slot_id) {
            await pool.query("UPDATE availability_slots SET is_available = TRUE WHERE id = $1", [
              appointmentResult.rows[0].slot_id,
            ])
          }
        }
      }

      await pool.query("COMMIT")
      logger.info(`Telemedicine session ${id} updated to status: ${status || "unchanged"}`)
      res.json({ message: "Telemedicine session updated", session: result.rows[0] })
    } catch (err) {
      await pool.query("ROLLBACK")
      logger.error(`Update telemedicine session error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  static async start(req, res) {
    const { id } = req.params

    try {
      await pool.query("BEGIN")

      // Get session with appointment details
      const sessionCheck = await pool.query(
        `SELECT ts.*, a.doctor_id, a.id AS appointment_id
         FROM telemedicine_sessions ts
         JOIN appointments a ON ts.appointment_id = a.id
         WHERE ts.id = $1`,
        [id],
      )

      if (sessionCheck.rows.length === 0) {
        await pool.query("ROLLBACK")
        return res.status(404).json({ error: "Telemedicine session not found" })
      }

      // Only doctors can start sessions
      if (req.user.role !== "doctor") {
        await pool.query("ROLLBACK")
        return res.status(403).json({ error: "Only doctors can start sessions" })
      }

      // Check if the doctor is authorized for this session
      if (sessionCheck.rows[0].doctor_id !== req.user.id) {
        await pool.query("ROLLBACK")
        return res.status(403).json({ error: "Not authorized to start this session" })
      }

      // Check if session is in a valid state to start
      if (sessionCheck.rows[0].status !== "scheduled") {
        await pool.query("ROLLBACK")
        return res.status(400).json({ error: `Cannot start session in '${sessionCheck.rows[0].status}' status` })
      }

      const result = await pool.query(
        "UPDATE telemedicine_sessions SET status = 'in-progress', start_time = NOW() WHERE id = $1 RETURNING *",
        [id],
      )

      // Update appointment status
      await pool.query("UPDATE appointments SET status = 'in-progress' WHERE id = $1", [
        sessionCheck.rows[0].appointment_id,
      ])

      await pool.query("COMMIT")
      logger.info(`Telemedicine session ${id} started by doctor ${req.user.id}`)
      res.json({ message: "Telemedicine session started", session: result.rows[0] })
    } catch (err) {
      await pool.query("ROLLBACK")
      logger.error(`Start telemedicine session error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  static async end(req, res) {
    const { id } = req.params
    const { notes } = req.body

    try {
      await pool.query("BEGIN")

      // Get session with appointment details
      const sessionCheck = await pool.query(
        `SELECT ts.*, a.doctor_id, a.id AS appointment_id
         FROM telemedicine_sessions ts
         JOIN appointments a ON ts.appointment_id = a.id
         WHERE ts.id = $1`,
        [id],
      )

      if (sessionCheck.rows.length === 0) {
        await pool.query("ROLLBACK")
        return res.status(404).json({ error: "Telemedicine session not found" })
      }

      // Only doctors can end sessions
      if (req.user.role !== "doctor") {
        await pool.query("ROLLBACK")
        return res.status(403).json({ error: "Only doctors can end sessions" })
      }

      // Check if the doctor is authorized for this session
      if (sessionCheck.rows[0].doctor_id !== req.user.id) {
        await pool.query("ROLLBACK")
        return res.status(403).json({ error: "Not authorized to end this session" })
      }

      // Check if session is in a valid state to end
      if (sessionCheck.rows[0].status !== "in-progress") {
        await pool.query("ROLLBACK")
        return res.status(400).json({ error: `Cannot end session in '${sessionCheck.rows[0].status}' status` })
      }

      const result = await pool.query(
        "UPDATE telemedicine_sessions SET status = 'completed', end_time = NOW(), notes = COALESCE($1, notes) WHERE id = $2 RETURNING *",
        [notes, id],
      )

      // Update appointment status
      await pool.query("UPDATE appointments SET status = 'completed' WHERE id = $1", [
        sessionCheck.rows[0].appointment_id,
      ])

      await pool.query("COMMIT")
      logger.info(`Telemedicine session ${id} ended by doctor ${req.user.id}`)
      res.json({ message: "Telemedicine session ended", session: result.rows[0] })
    } catch (err) {
      await pool.query("ROLLBACK")
      logger.error(`End telemedicine session error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  /**
   * Get telemedicine session by appointment ID
   */
  static async getByAppointmentId(req, res) {
    try {
      const { appointmentId } = req.params

      if (!req.user || !req.user.id) {
        return res.status(401).json({ error: "Unauthorized" })
      }

      // Get session details by appointment ID
      const result = await executeQuery(
        `SELECT ts.*, a.status as appointment_status,
                u1.full_name AS patient_name, u2.full_name AS doctor_name,
                s.start_time AS appointment_time, s.end_time AS appointment_end_time
         FROM telemedicine_sessions ts 
         JOIN appointments a ON ts.appointment_id = a.id 
         JOIN users u1 ON ts.patient_id = u1.id
         JOIN users u2 ON ts.doctor_id = u2.id
         LEFT JOIN availability_slots s ON a.slot_id = s.id
         WHERE ts.appointment_id = $1 AND (ts.patient_id = $2 OR ts.doctor_id = $2)`,
        [appointmentId, req.user.id],
      )

      if (result.rows.length === 0) {
        return res.status(404).json({ 
          error: "Session not found or unauthorized",
          message: "Telemedicine session not found for this appointment"
        })
      }

      const session = result.rows[0]

      // Check timing validation with more flexible logic
      const appointmentTime = new Date(session.appointment_time || session.scheduled_time)
      const now = new Date()
      const fifteenMinutesBefore = new Date(appointmentTime.getTime() - 15 * 60 * 1000)
      const twoHoursAfter = new Date(appointmentTime.getTime() + 2 * 60 * 60 * 1000) // 2 hours after appointment

      // Determine if session can be joined based on status and timing
      let canJoin = false
      let joinMessage = ""

      // If session is already in progress, allow joining regardless of time
      if (session.status === "in-progress") {
        canJoin = true
        joinMessage = "Session is in progress - you can join now"
      }
      // If session is completed or cancelled, don't allow joining
      else if (session.status === "completed" || session.status === "cancelled") {
        canJoin = false
        joinMessage = `Session has been ${session.status}`
      }
      // For scheduled sessions, check timing
      else if (session.status === "scheduled") {
        if (now < fifteenMinutesBefore) {
          const minutesUntilJoin = Math.floor((fifteenMinutesBefore.getTime() - now.getTime()) / (1000 * 60))
          joinMessage = `Session will be available in ${minutesUntilJoin} minutes`
        } else if (now > twoHoursAfter) {
          // Only mark as passed if it's been more than 2 hours since the appointment
          canJoin = false
          joinMessage = "Session has already passed"
        } else {
          // Within the valid time window (15 min before to 2 hours after)
          canJoin = true
          joinMessage = "Session is available"
        }
      }
      // For any other status, allow joining
      else {
        canJoin = true
        joinMessage = "Session is available"
      }

      res.status(200).json({
        success: true,
        data: {
          id: session.id,
          appointment_id: session.appointment_id,
          patient_id: session.patient_id,
          doctor_id: session.doctor_id,
          status: session.status,
          scheduled_time: session.scheduled_time,
          start_time: session.start_time,
          end_time: session.end_time,
          video_link: session.video_link,
          session_url: session.session_url,
          meeting_id: session.meeting_id,
          platform: session.platform,
          patient_name: session.patient_name,
          doctor_name: session.doctor_name,
          appointment_status: session.appointment_status,
          appointment_time: session.appointment_time,
          can_join: canJoin,
          join_message: joinMessage,
          timing: {
            appointment_time: appointmentTime.toISOString(),
            current_time: now.toISOString(),
            earliest_join_time: fifteenMinutesBefore.toISOString(),
            latest_join_time: twoHoursAfter.toISOString()
          }
        }
      })
    } catch (err) {
      logger.error(`Get telemedicine session by appointment ID error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }
}

module.exports = TelemedicineController
