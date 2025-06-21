/**
 * Availability Controller
 *
 * Unified controller for managing availability slots for all provider types
 * (doctors, lab technicians, nurses, etc.)
 */
const { pool } = require("../config/database")
const logger = require("../middleware/logger")
const { body, validationResult } = require("express-validator")

// Improved date parsing function
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

// Improved database formatting function
function formatDateForDB(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  const hours = String(date.getHours()).padStart(2, "0")
  const minutes = String(date.getMinutes()).padStart(2, "0")
  const seconds = String(date.getSeconds()).padStart(2, "0")

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

// Fixed overlap detection function
function checkTimeOverlap(start1, end1, start2, end2) {
  // Convert to timestamps for precise comparison
  const s1 = new Date(start1).getTime()
  const e1 = new Date(end1).getTime()
  const s2 = new Date(start2).getTime()
  const e2 = new Date(end2).getTime()

  // True overlap occurs when:
  // - New slot starts before existing ends AND new slot ends after existing starts
  // We need to exclude touching boundaries (adjacent slots are OK)
  return s1 < e2 && e1 > s2
}

class AvailabilityController {
  /**
   * Create availability slot with improved overlap prevention
   */
  static async create(req, res) {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() })
    }

    const { clinicId, startTime, endTime, recurring, isTelemedicine } = req.body
    const providerId = req.user.id
    const providerType = req.body.providerType || "doctor"

    try {
      console.log(`Creating ${providerType} slot for provider:`, providerId, "with data:", {
        clinicId,
        startTime,
        endTime,
        recurring,
        isTelemedicine,
      })

      // Handle recurring slots first
      if (recurring && recurring.pattern) {
        console.log("Processing recurring availability pattern:", recurring)

        // Validate recurring pattern data
        if (!recurring.startDate || !recurring.endDate || !recurring.dailyStartTime || !recurring.dailyEndTime) {
          return res.status(400).json({
            error: "Missing required recurring pattern data",
            details: "startDate, endDate, dailyStartTime, and dailyEndTime are required for recurring patterns",
          })
        }

        // Handle telemedicine appointments
        if (isTelemedicine) {
          console.log("Creating telemedicine recurring slots - no clinic required")
        } else {
          // For in-person appointments, clinic is required
          if (!clinicId) {
            // Check if doctor has any clinic associations for default
            if (providerType === "doctor") {
              const doctorClinicsCheck = await pool.query(
                "SELECT clinic_id FROM doctor_clinics WHERE doctor_id = $1 LIMIT 1",
                [providerId],
              )

              if (doctorClinicsCheck.rows.length === 0) {
                return res.status(400).json({
                  error: "Doctor must be associated with at least one clinic to create in-person availability slots",
                  details: "Please contact your administrator to associate you with a clinic.",
                })
              }

              // Use the first clinic if none specified
              req.body.clinicId = doctorClinicsCheck.rows[0].clinic_id
              console.log(`Using default clinic ${req.body.clinicId} for doctor ${providerId}`)
            } else {
              return res.status(400).json({
                error: "Clinic ID is required for in-person appointments",
              })
            }
          }
        }

        // Use the final clinic ID (can be null for telemedicine)
        const finalClinicId = isTelemedicine ? null : clinicId || req.body.clinicId

        // Verify provider is associated with this clinic for non-telemedicine appointments
        if (!isTelemedicine && finalClinicId) {
          let associationTable, providerColumn

          switch (providerType) {
            case "doctor":
              associationTable = "doctor_clinics"
              providerColumn = "doctor_id"
              break
            case "lab":
              associationTable = "lab_clinics"
              providerColumn = "lab_id"
              break
            case "nurse":
              associationTable = "nurse_clinics"
              providerColumn = "nurse_id"
              break
            default:
              return res.status(400).json({ error: "Invalid provider type" })
          }

          const providerClinicCheck = await pool.query(
            `SELECT 1 FROM ${associationTable} WHERE ${providerColumn} = $1 AND clinic_id = $2`,
            [providerId, finalClinicId],
          )

          if (providerClinicCheck.rows.length === 0) {
            return res.status(403).json({
              error: `You can only create availability slots for clinics you are associated with`,
            })
          }
        }

        await pool.query("BEGIN")

        const slots = []

        // Use the recurring pattern's date range and time information
        const startDate = new Date(recurring.startDate)
        const endDate = new Date(recurring.endDate)

        const dailyStartTime = recurring.dailyStartTime
        const dailyEndTime = recurring.dailyEndTime
        const slotDuration = recurring.slotDuration || 30

        console.log("Processing recurring pattern:", {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          dailyStartTime,
          dailyEndTime,
          slotDuration,
          daysOfWeek: recurring.daysOfWeek,
        })

        // Get all existing slots for this provider to check overlaps
        const existingSlotsQuery = `
          SELECT start_time, end_time, clinic_id
          FROM availability_slots 
          WHERE provider_id = $1 AND provider_type = $2
        `
        const existingSlots = await pool.query(existingSlotsQuery, [providerId, providerType])

        // Generate slots for each day in the date range
        const currentDate = new Date(startDate)

        while (currentDate <= endDate) {
          const dayOfWeek = currentDate.getDay()

          // Check if this day is in the selected days of week
          if (recurring.daysOfWeek && recurring.daysOfWeek.includes(dayOfWeek)) {
            // Parse daily start and end times
            const [startHour, startMinute] = dailyStartTime.split(":").map(Number)
            const [endHour, endMinute] = dailyEndTime.split(":").map(Number)

            // Create time slots for this day
            let currentSlotStart = new Date(currentDate)
            currentSlotStart.setHours(startHour, startMinute, 0, 0)

            const dayEndTime = new Date(currentDate)
            dayEndTime.setHours(endHour, endMinute, 0, 0)

            // Generate slots with the specified duration
            while (currentSlotStart < dayEndTime) {
              const currentSlotEnd = new Date(currentSlotStart.getTime() + slotDuration * 60000)

              // Don't create slots that extend beyond the daily end time
              if (currentSlotEnd > dayEndTime) {
                break
              }

              // Check for overlap with existing slots
              let hasOverlap = false
              for (const existingSlot of existingSlots.rows) {
                if (
                  checkTimeOverlap(
                    formatDateForDB(currentSlotStart),
                    formatDateForDB(currentSlotEnd),
                    existingSlot.start_time,
                    existingSlot.end_time,
                  )
                ) {
                  hasOverlap = true
                  console.log(
                    `Skipped overlapping slot: ${formatDateForDB(currentSlotStart)} - ${formatDateForDB(currentSlotEnd)} (conflicts with existing slot)`,
                  )
                  break
                }
              }

              if (!hasOverlap) {
                // Insert non-overlapping slot
                const slotResult = await pool.query(
                  "INSERT INTO availability_slots (provider_id, provider_type, clinic_id, start_time, end_time) VALUES ($1, $2, $3, $4, $5) RETURNING *",
                  [
                    providerId,
                    providerType,
                    finalClinicId,
                    formatDateForDB(currentSlotStart),
                    formatDateForDB(currentSlotEnd),
                  ],
                )
                slots.push(slotResult.rows[0])
                // Add to existing slots for future overlap checks
                existingSlots.rows.push({
                  start_time: formatDateForDB(currentSlotStart),
                  end_time: formatDateForDB(currentSlotEnd),
                  clinic_id: finalClinicId,
                })
                console.log(`Created slot: ${formatDateForDB(currentSlotStart)} - ${formatDateForDB(currentSlotEnd)}`)
              }

              // Move to next slot
              currentSlotStart = new Date(currentSlotEnd)
            }
          }

          // Move to next day
          currentDate.setDate(currentDate.getDate() + 1)
        }

        await pool.query("COMMIT")
        console.log(`Successfully created ${slots.length} recurring availability slots`)
        return res.status(201).json({
          message: `Created ${slots.length} recurring availability slots`,
          data: { slots: slots },
        })
      }

      // Handle single slot creation (non-recurring)
      if (!startTime || !endTime) {
        return res.status(400).json({
          error: "startTime and endTime are required for non-recurring slots",
        })
      }

      // Handle telemedicine appointments
      if (isTelemedicine) {
        console.log("Creating telemedicine slot - no clinic required")
      } else {
        // For in-person appointments, clinic is required
        if (!clinicId) {
          // Check if doctor has any clinic associations for default
          if (providerType === "doctor") {
            const doctorClinicsCheck = await pool.query(
              "SELECT clinic_id FROM doctor_clinics WHERE doctor_id = $1 LIMIT 1",
              [providerId],
            )

            if (doctorClinicsCheck.rows.length === 0) {
              return res.status(400).json({
                error: "Doctor must be associated with at least one clinic to create in-person availability slots",
                details: "Please contact your administrator to associate you with a clinic.",
              })
            }

            // Use the first clinic if none specified
            req.body.clinicId = doctorClinicsCheck.rows[0].clinic_id
            console.log(`Using default clinic ${req.body.clinicId} for doctor ${providerId}`)
          } else {
            return res.status(400).json({
              error: "Clinic ID is required for in-person appointments",
            })
          }
        }
      }

      // Use the final clinic ID (can be null for telemedicine)
      const finalClinicId = isTelemedicine ? null : clinicId || req.body.clinicId

      // Verify provider is associated with this clinic for non-telemedicine appointments
      if (!isTelemedicine && finalClinicId) {
        let associationTable, providerColumn

        switch (providerType) {
          case "doctor":
            associationTable = "doctor_clinics"
            providerColumn = "doctor_id"
            break
          case "lab":
            associationTable = "lab_clinics"
            providerColumn = "lab_id"
            break
          case "nurse":
            associationTable = "nurse_clinics"
            providerColumn = "nurse_id"
            break
          default:
            return res.status(400).json({ error: "Invalid provider type" })
        }

        const providerClinicCheck = await pool.query(
          `SELECT 1 FROM ${associationTable} WHERE ${providerColumn} = $1 AND clinic_id = $2`,
          [providerId, finalClinicId],
        )

        if (providerClinicCheck.rows.length === 0) {
          return res.status(403).json({
            error: `You can only create availability slots for clinics you are associated with`,
          })
        }
      }

      // Parse time strings without timezone conversion
      const start = parseLocalDateString(startTime)
      const end = parseLocalDateString(endTime)

      console.log("Parsed start time:", start)
      console.log("Parsed end time:", end)

      if (start >= end) {
        return res.status(400).json({ error: "End time must be after start time" })
      }

      // Duration check (minimum 15 minutes, maximum 4 hours)
      const durationMinutes = (end - start) / (1000 * 60)
      if (durationMinutes < 15) {
        return res.status(400).json({ error: "Slot duration must be at least 15 minutes" })
      }
      if (durationMinutes > 240) {
        return res.status(400).json({ error: "Slot duration cannot exceed 4 hours" })
      }

      await pool.query("BEGIN")

      // Improved overlap check - get all existing slots and check programmatically
      const existingSlotsQuery = `
        SELECT id, clinic_id, start_time, end_time,
        CASE WHEN clinic_id IS NULL THEN 'Telemedicine' ELSE 'In-Person' END as appointment_type
        FROM availability_slots 
        WHERE provider_id = $1 AND provider_type = $2
      `

      const existingSlots = await pool.query(existingSlotsQuery, [providerId, providerType])

      // Check for actual overlaps
      const newStartTime = formatDateForDB(start)
      const newEndTime = formatDateForDB(end)

      for (const existingSlot of existingSlots.rows) {
        if (checkTimeOverlap(newStartTime, newEndTime, existingSlot.start_time, existingSlot.end_time)) {
          await pool.query("ROLLBACK")
          return res.status(400).json({
            error: `This slot overlaps with an existing ${existingSlot.appointment_type} appointment`,
            details: `You already have a ${existingSlot.appointment_type} slot from ${new Date(existingSlot.start_time).toLocaleTimeString()} to ${new Date(existingSlot.end_time).toLocaleTimeString()}`,
            conflictingSlots: [existingSlot],
            debug: {
              newSlot: { start: newStartTime, end: newEndTime },
              existingSlot: { start: existingSlot.start_time, end: existingSlot.end_time },
            },
          })
        }
      }

      // Create single slot
      const { rows } = await pool.query(
        "INSERT INTO availability_slots (provider_id, provider_type, clinic_id, start_time, end_time) VALUES ($1, $2, $3, $4, $5) RETURNING *",
        [providerId, providerType, finalClinicId, newStartTime, newEndTime],
      )

      await pool.query("COMMIT")
      console.log("Slot created:", rows[0])
      res.status(201).json({
        message: "Availability slot created successfully",
        data: { slot: rows[0] },
      })
    } catch (error) {
      await pool.query("ROLLBACK")
      console.error("Error creating slot:", error)
      res.status(500).json({ error: "Server error", details: error.message })
    }
  }

  /**
   * Get all slots with filtering
   */
  static async getAll(req, res) {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() })
    }

    try {
      // Check if availability_slots table exists
      const tableCheck = await pool.query(
        "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'availability_slots')",
      )

      if (!tableCheck.rows[0].exists) {
        return res.status(200).json([])
      }

      const { providerId, providerType, clinicId, startDate, endDate, available } = req.query

      let query = `
        SELECT a.*, u.full_name AS provider_name, c.name AS clinic_name 
        FROM availability_slots a 
        JOIN users u ON a.provider_id = u.id 
        LEFT JOIN clinics c ON a.clinic_id = c.id 
        WHERE 1=1
      `
      const params = []
      let paramIndex = 1

      // Base filtering by role
      if (req.user.role === "doctor" || req.user.role === "lab" || req.user.role === "nurse") {
        query += ` AND a.provider_id = $${paramIndex++} AND a.provider_type = $${paramIndex++}`
        params.push(req.user.id, req.user.role)
      } else if (req.user.role === "patient") {
        query += ` AND a.is_available = TRUE`
      }

      // Additional filters
      if (providerId && (req.user.role === "clinic_admin" || req.user.role === "platform_admin")) {
        query += ` AND a.provider_id = $${paramIndex++}`
        params.push(providerId)
      }

      if (providerType) {
        query += ` AND a.provider_type = $${paramIndex++}`
        params.push(providerType)
      }

      if (clinicId) {
        query += ` AND a.clinic_id = $${paramIndex++}`
        params.push(clinicId)
      }

      if (startDate) {
        query += ` AND a.start_time >= $${paramIndex++}`
        params.push(startDate)
      }

      if (endDate) {
        query += ` AND a.start_time <= $${paramIndex++}`
        params.push(endDate)
      }

      if (available !== undefined) {
        query += ` AND a.is_available = $${paramIndex++}`
        params.push(available === "true" || available === true)
      }

      query += " ORDER BY a.start_time"

      const { rows } = await pool.query(query, params)
      res.status(200).json(rows)
    } catch (error) {
      console.error("Error fetching slots:", error)
      res.status(500).json({ error: "Server error", details: error.message })
    }
  }

  /**
   * Delete availability slot
   */
  static async delete(req, res) {
    const { id } = req.params

    try {
      await pool.query("BEGIN")

      // Check if slot exists and belongs to the provider
      let slotCheck
      if (req.user.role === "doctor" || req.user.role === "lab" || req.user.role === "nurse") {
        slotCheck = await pool.query(
          "SELECT * FROM availability_slots WHERE id = $1 AND provider_id = $2 AND provider_type = $3",
          [id, req.user.id, req.user.role],
        )
      } else if (req.user.role === "clinic_admin" || req.user.role === "platform_admin") {
        slotCheck = await pool.query("SELECT * FROM availability_slots WHERE id = $1", [id])
      } else {
        await pool.query("ROLLBACK")
        return res.status(403).json({ error: "Not authorized to delete availability slots" })
      }

      if (slotCheck.rows.length === 0) {
        await pool.query("ROLLBACK")
        return res.status(404).json({ error: "Slot not found or you don't have permission to delete it" })
      }

      // Check if slot is already booked
      const appointmentCheck = await pool.query(
        "SELECT id FROM appointments WHERE slot_id = $1 AND status != 'cancelled'",
        [id],
      )

      if (appointmentCheck.rows.length > 0) {
        await pool.query("ROLLBACK")
        return res.status(400).json({
          error: "Cannot delete slot with active appointments",
          appointments: appointmentCheck.rows,
        })
      }

      // Delete the slot
      await pool.query("DELETE FROM availability_slots WHERE id = $1", [id])

      await pool.query("COMMIT")
      res.status(200).json({ message: "Availability slot deleted successfully" })
    } catch (error) {
      await pool.query("ROLLBACK")
      console.error("Error deleting slot:", error)
      res.status(500).json({ error: "Server error", details: error.message })
    }
  }

  /**
   * Update availability slot
   */
  static async update(req, res) {
    const errors = validationResult(req)
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() })
    }

    const { id } = req.params
    const { startTime, endTime, isAvailable } = req.body

    try {
      await pool.query("BEGIN")

      // Check if slot exists and belongs to the provider
      let slotCheck
      if (req.user.role === "doctor" || req.user.role === "lab" || req.user.role === "nurse") {
        slotCheck = await pool.query(
          "SELECT * FROM availability_slots WHERE id = $1 AND provider_id = $2 AND provider_type = $3",
          [id, req.user.id, req.user.role],
        )
      } else if (req.user.role === "clinic_admin" || req.user.role === "platform_admin") {
        slotCheck = await pool.query("SELECT * FROM availability_slots WHERE id = $1", [id])
      } else {
        await pool.query("ROLLBACK")
        return res.status(403).json({ error: "Not authorized to update availability slots" })
      }

      if (slotCheck.rows.length === 0) {
        await pool.query("ROLLBACK")
        return res.status(404).json({ error: "Slot not found or you don't have permission to update it" })
      }

      // Check if slot has appointments if trying to change times
      if ((startTime || endTime) && isAvailable !== false) {
        const appointmentCheck = await pool.query(
          "SELECT id FROM appointments WHERE slot_id = $1 AND status != 'cancelled'",
          [id],
        )

        if (appointmentCheck.rows.length > 0) {
          await pool.query("ROLLBACK")
          return res.status(400).json({
            error: "Cannot modify time for slot with active appointments",
            appointments: appointmentCheck.rows,
          })
        }
      }

      // Check for overlaps if changing times
      if (startTime && endTime) {
        const start = new Date(startTime)
        const end = new Date(endTime)

        if (start >= end) {
          await pool.query("ROLLBACK")
          return res.status(400).json({ error: "End time must be after start time" })
        }

        // Get all existing slots except the current one
        const existingSlotsQuery = `
          SELECT id, clinic_id, start_time, end_time,
          CASE WHEN clinic_id IS NULL THEN 'Telemedicine' ELSE 'In-Person' END as appointment_type
          FROM availability_slots 
          WHERE provider_id = $1 AND provider_type = $2 AND id != $3
        `

        const existingSlots = await pool.query(existingSlotsQuery, [
          slotCheck.rows[0].provider_id,
          slotCheck.rows[0].provider_type,
          id,
        ])

        // Check for actual overlaps
        const newStartTime = formatDateForDB(start)
        const newEndTime = formatDateForDB(end)

        for (const existingSlot of existingSlots.rows) {
          if (checkTimeOverlap(newStartTime, newEndTime, existingSlot.start_time, existingSlot.end_time)) {
            await pool.query("ROLLBACK")
            return res.status(400).json({
              error: `This slot would overlap with an existing ${existingSlot.appointment_type} appointment`,
              conflictingSlots: [existingSlot],
            })
          }
        }
      }

      // Update the slot
      const updateQuery = `
        UPDATE availability_slots 
        SET 
          start_time = COALESCE($1, start_time),
          end_time = COALESCE($2, end_time),
          is_available = COALESCE($3, is_available),
          updated_at = NOW()
        WHERE id = $4
        RETURNING *
      `

      const result = await pool.query(updateQuery, [
        startTime ? formatDateForDB(new Date(startTime)) : null,
        endTime ? formatDateForDB(new Date(endTime)) : null,
        isAvailable !== undefined ? isAvailable : null,
        id,
      ])

      await pool.query("COMMIT")
      res.status(200).json({
        message: "Availability slot updated successfully",
        data: { slot: result.rows[0] },
      })
    } catch (error) {
      await pool.query("ROLLBACK")
      console.error("Error updating slot:", error)
      res.status(500).json({ error: "Server error", details: error.message })
    }
  }
}

module.exports = AvailabilityController
