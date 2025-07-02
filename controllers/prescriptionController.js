const { executeQuery } = require("../utils/dbUtils")
const logger = require("../middleware/logger")
const PDFDocument = require("pdfkit")
const fs = require("fs")
const path = require("path")
const db = require("../config/database")
const asyncHandler = require("../utils/asyncHandler")
const { validationResult } = require("express-validator")
const NotificationController = require("./notificationController")

class PrescriptionController {
  /**
   * Create a new prescription
   * POST /api/prescriptions
   */
  static async create(req, res) {
    const {
      patient_id,
      appointment_id,
      clinic_id,
      diagnosis,
      medications,
      notes,
      follow_up_date,
      refills_remaining = 0,
    } = req.body
    const { dbTransaction } = req

    try {
      // Input validation
      if (!patient_id) {
        return res.status(400).json({ success: false, error: "Patient ID is required" })
      }

      if (!diagnosis) {
        return res.status(400).json({ success: false, error: "Diagnosis is required" })
      }

      if (!medications || !Array.isArray(medications) || medications.length === 0) {
        return res.status(400).json({ success: false, error: "At least one medication is required" })
      }

      // Validate each medication
      for (const medication of medications) {
        const requiredFields = ["name", "dosage", "frequency", "duration", "instructions", "quantity"]
        for (const field of requiredFields) {
          if (!medication[field]) {
            return res.status(400).json({
              success: false,
              error: `Medication ${field} is required`,
            })
          }
        }
        if (medication.quantity < 1) {
          return res.status(400).json({
            success: false,
            error: "Medication quantity must be at least 1",
          })
        }
      }

      // Verify patient exists and is actually a patient
      const patientCheck = await dbTransaction.query(
        `SELECT u.id, u.full_name, r.name as role_name
         FROM users u 
         JOIN roles r ON u.role_id = r.id 
         WHERE u.id = $1 AND r.name = 'patient'`,
        [patient_id],
      )

      if (patientCheck.rows.length === 0) {
        return res.status(404).json({ success: false, error: "Patient not found" })
      }

      // Verify doctor authorization
      if (req.user.role !== "doctor") {
        return res.status(403).json({ success: false, error: "Only doctors can create prescriptions" })
      }

      let effectiveClinicId = clinic_id

      // If appointment_id is provided, verify it and get clinic_id from it
      if (appointment_id) {
        const appointmentCheck = await dbTransaction.query(
          `SELECT clinic_id, patient_id, doctor_id, status 
           FROM appointments 
           WHERE id = $1`,
          [appointment_id],
        )

        if (appointmentCheck.rows.length === 0) {
          return res.status(400).json({ success: false, error: "Appointment not found" })
        }

        const appointment = appointmentCheck.rows[0]

        // Verify the appointment belongs to the correct patient and doctor
        if (appointment.patient_id !== Number.parseInt(patient_id)) {
          return res.status(400).json({ success: false, error: "Appointment does not belong to the specified patient" })
        }

        if (appointment.doctor_id !== req.user.id) {
          return res
            .status(400)
            .json({ success: false, error: "You can only create prescriptions for your own appointments" })
        }

        effectiveClinicId = appointment.clinic_id
      }

      // If no clinic_id provided, try to find one associated with the doctor
      if (!effectiveClinicId) {
        const doctorClinicCheck = await dbTransaction.query(
          "SELECT clinic_id FROM doctor_clinics WHERE doctor_id = $1 LIMIT 1",
          [req.user.id],
        )

        if (doctorClinicCheck.rows.length > 0) {
          effectiveClinicId = doctorClinicCheck.rows[0].clinic_id
        } else {
          return res.status(400).json({
            success: false,
            error: "Clinic ID is required when no appointment is specified",
          })
        }
      }

      // Verify clinic exists
      if (effectiveClinicId) {
        const clinicCheck = await dbTransaction.query("SELECT id, name FROM clinics WHERE id = $1", [effectiveClinicId])
        if (clinicCheck.rows.length === 0) {
          return res.status(404).json({ success: false, error: "Clinic not found" })
        }
      }

      // Generate prescription number
      const prescriptionNumber = await generatePrescriptionNumber(dbTransaction)

      // Properly stringify medications - fix the JSON parsing error
      let medicationJson
      try {
        medicationJson = JSON.stringify(medications)
      } catch (error) {
        logger.error(`Error stringifying medications: ${error.message}`)
        return res.status(400).json({ success: false, error: "Invalid medication data format" })
      }

      // Insert prescription with proper JSON stringification
      const result = await dbTransaction.query(
        `INSERT INTO prescriptions 
         (patient_id, doctor_id, clinic_id, appointment_id, prescription_number, diagnosis, medication, notes, follow_up_date, refills_remaining, status) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) 
         RETURNING *`,
        [
          patient_id,
          req.user.id,
          effectiveClinicId,
          appointment_id || null,
          prescriptionNumber,
          diagnosis,
          medicationJson, // Use properly stringified JSON
          notes || null,
          follow_up_date || null,
          refills_remaining,
          "active",
        ],
      )

      await dbTransaction.commit()

      const prescription = result.rows[0]

      // Parse medications safely for response
      try {
        prescription.medications = JSON.parse(prescription.medication)
      } catch (e) {
        logger.error(`Error parsing medication JSON for response ${prescription.id}: ${e.message}`)
        prescription.medications = medications // Use original medications array
      }

      prescription.patient_name = patientCheck.rows[0].full_name

      // Create notification for patient
      await createNotification(
        patient_id,
        `New prescription created by Dr. ${req.user.full_name}`,
        "prescription_created",
        prescription.id,
      )

      logger.info(`Prescription created: ${prescription.id} for patient: ${patient_id} by doctor: ${req.user.id}`)

      res.status(201).json({
        success: true,
        message: "Prescription created successfully",
        prescription,
      })
    } catch (err) {
      if (dbTransaction) {
        await dbTransaction.rollback()
      }
      logger.error(`Create prescription error: ${err.message}`)
      res.status(500).json({ success: false, error: "Server error", details: err.message })
    }
  }

  /**
   * Get all prescriptions with filtering and pagination
   * GET /api/prescriptions
   */
  static async getAll(req, res) {
    try {
      const {
        status,
        patient_id,
        doctor_id,
        clinic_id,
        limit = 50,
        offset = 0,
        search,
        start_date,
        end_date,
        sort_by = "created_at",
        sort_order = "DESC",
      } = req.query

      let query,
        params = []
      const whereConditions = []
      let paramCount = 1

      // Base query with joins
      const baseQuery = `
        SELECT p.*, 
               u1.full_name AS patient_name,
               u1.email AS patient_email,
               u2.full_name AS doctor_name,
               u2.email AS doctor_email,
               c.name AS clinic_name,
               c.address AS clinic_address,
               c.phone AS clinic_phone,
               a.created_at AS appointment_date,
               a.type AS appointment_type
        FROM prescriptions p 
        JOIN users u1 ON p.patient_id = u1.id 
        JOIN users u2 ON p.doctor_id = u2.id 
        LEFT JOIN clinics c ON p.clinic_id = c.id 
        LEFT JOIN appointments a ON p.appointment_id = a.id
      `

      // Build WHERE conditions based on user role and filters
      if (req.user.role === "patient") {
        whereConditions.push(`p.patient_id = $${paramCount}`)
        params.push(req.user.id)
        paramCount++

        // Only show active prescriptions to patients unless they explicitly request a different status
        if (!status) {
          whereConditions.push(`p.status = 'active'`)
        }
      } else if (req.user.role === "doctor") {
        whereConditions.push(`p.doctor_id = $${paramCount}`)
        params.push(req.user.id)
        paramCount++
      } else if (req.user.role === "clinic_admin") {
        whereConditions.push(`p.clinic_id IN (SELECT clinic_id FROM admin_clinics WHERE admin_id = $${paramCount})`)
        params.push(req.user.id)
        paramCount++
      } else if (req.user.role !== "platform_admin") {
        return res.status(403).json({ success: false, error: "Unauthorized access to prescriptions" })
      }

      // Add additional filters
      if (status && status !== "all") {
        whereConditions.push(`p.status = $${paramCount}`)
        params.push(status)
        paramCount++
      }

      if (
        patient_id &&
        (req.user.role === "doctor" || req.user.role === "clinic_admin" || req.user.role === "platform_admin")
      ) {
        whereConditions.push(`p.patient_id = $${paramCount}`)
        params.push(patient_id)
        paramCount++
      }

      if (doctor_id && (req.user.role === "clinic_admin" || req.user.role === "platform_admin")) {
        whereConditions.push(`p.doctor_id = $${paramCount}`)
        params.push(doctor_id)
        paramCount++
      }

      if (clinic_id && req.user.role === "platform_admin") {
        whereConditions.push(`p.clinic_id = $${paramCount}`)
        params.push(clinic_id)
        paramCount++
      }

      if (search) {
        whereConditions.push(`(
          p.diagnosis ILIKE $${paramCount} OR 
          p.prescription_number ILIKE $${paramCount} OR
          u1.full_name ILIKE $${paramCount} OR
          u2.full_name ILIKE $${paramCount} OR
          p.medication::text ILIKE $${paramCount}
        )`)
        params.push(`%${search}%`)
        paramCount++
      }

      if (start_date) {
        whereConditions.push(`p.created_at >= $${paramCount}`)
        params.push(start_date)
        paramCount++
      }

      if (end_date) {
        whereConditions.push(`p.created_at <= $${paramCount}`)
        params.push(end_date)
        paramCount++
      }

      // Build final query
      query = baseQuery
      if (whereConditions.length > 0) {
        query += ` WHERE ${whereConditions.join(" AND ")}`
      }

      // Add sorting
      const validSortColumns = ["created_at", "updated_at", "status", "patient_name", "doctor_name"]
      const sortColumn = validSortColumns.includes(sort_by) ? sort_by : "created_at"
      const sortDirection = sort_order.toUpperCase() === "ASC" ? "ASC" : "DESC"

      if (sortColumn === "patient_name") {
        query += ` ORDER BY u1.full_name ${sortDirection}`
      } else if (sortColumn === "doctor_name") {
        query += ` ORDER BY u2.full_name ${sortDirection}`
      } else {
        query += ` ORDER BY p.${sortColumn} ${sortDirection}`
      }

      // Add pagination
      query += ` LIMIT $${paramCount} OFFSET $${paramCount + 1}`
      params.push(Number.parseInt(limit), Number.parseInt(offset))

      logger.info(`Executing prescription query for user ${req.user.id} (${req.user.role})`)
      const result = await executeQuery(query, params)

      // Get total count for pagination
      let countQuery = `
        SELECT COUNT(*) as total
        FROM prescriptions p 
        JOIN users u1 ON p.patient_id = u1.id 
        JOIN users u2 ON p.doctor_id = u2.id 
        LEFT JOIN clinics c ON p.clinic_id = c.id
      `
      if (whereConditions.length > 0) {
        countQuery += ` WHERE ${whereConditions.join(" AND ")}`
      }

      const countResult = await executeQuery(countQuery, params.slice(0, -2)) // Remove limit and offset
      const total = Number.parseInt(countResult.rows[0].total)

      // Parse medications JSON for each prescription safely
      const prescriptions = result.rows.map((prescription) => {
        try {
          if (typeof prescription.medication === "string") {
            prescription.medications = JSON.parse(prescription.medication)
          } else if (Array.isArray(prescription.medication)) {
            prescription.medications = prescription.medication
          } else {
            prescription.medications = []
          }
        } catch (e) {
          logger.error(`Error parsing medication JSON for prescription ${prescription.id}: ${e.message}`)
          prescription.medications = []
        }
        return prescription
      })

      res.json({
        success: true,
        data: prescriptions,
        pagination: {
          total,
          limit: Number.parseInt(limit),
          offset: Number.parseInt(offset),
          page: Math.floor(Number.parseInt(offset) / Number.parseInt(limit)) + 1,
          totalPages: Math.ceil(total / Number.parseInt(limit)),
        },
      })
    } catch (err) {
      logger.error(`Get prescriptions error: ${err.message}`)
      res.status(500).json({ success: false, error: "Server error", details: err.message })
    }
  }

  /**
   * Get a single prescription by ID
   * GET /api/prescriptions/:id
   */
  static async getById(req, res) {
    const { id } = req.params

    try {
      let query, params

      // Fixed query - use patient_id instead of user_id for patient_medical_profiles
      const baseQuery = `
  SELECT p.*, 
         u1.full_name AS patient_name,
         u1.email AS patient_email,
         u1.phone AS patient_phone,
         pm.allergies AS patient_allergies,
         u2.full_name AS doctor_name,
         u2.email AS doctor_email,
         u2.phone AS doctor_phone,
         u2.specialization AS doctor_specialization,
         u2.license_number AS doctor_license,
         c.name AS clinic_name,
         c.address AS clinic_address,
         c.phone AS clinic_phone,
         a.created_at AS appointment_date,
         a.type AS appointment_type,
         a.reason AS appointment_reason
  FROM prescriptions p 
  JOIN users u1 ON p.patient_id = u1.id 
  JOIN users u2 ON p.doctor_id = u2.id 
  LEFT JOIN clinics c ON p.clinic_id = c.id 
  LEFT JOIN appointments a ON p.appointment_id = a.id
  LEFT JOIN patient_medical_profiles pm ON p.patient_id = pm.patient_id
  WHERE p.id = $1
`

      // Add authorization based on user role
      if (req.user.role === "patient") {
        query = baseQuery + ` AND p.patient_id = $2`
        params = [id, req.user.id]
      } else if (req.user.role === "doctor") {
        query = baseQuery + ` AND p.doctor_id = $2`
        params = [id, req.user.id]
      } else if (req.user.role === "clinic_admin") {
        query = baseQuery + ` AND p.clinic_id IN (SELECT clinic_id FROM admin_clinics WHERE admin_id = $2)`
        params = [id, req.user.id]
      } else if (req.user.role === "platform_admin") {
        query = baseQuery
        params = [id]
      } else {
        return res.status(403).json({ success: false, error: "Unauthorized access to prescription" })
      }

      const result = await executeQuery(query, params)

      if (!result.rows.length) {
        return res.status(404).json({ success: false, error: "Prescription not found" })
      }

      const prescription = result.rows[0]

      // Parse medications JSON safely
      try {
        if (typeof prescription.medication === "string") {
          prescription.medications = JSON.parse(prescription.medication)
        } else if (Array.isArray(prescription.medication)) {
          prescription.medications = prescription.medication
        } else {
          prescription.medications = []
        }
      } catch (e) {
        logger.error(`Error parsing medication JSON for prescription ${prescription.id}: ${e.message}`)
        prescription.medications = []
      }

      res.json({
        success: true,
        data: prescription,
      })
    } catch (err) {
      logger.error(`Get prescription by ID error: ${err.message}`)
      res.status(500).json({ success: false, error: "Server error", details: err.message })
    }
  }

  /**
   * Update a prescription
   * PUT /api/prescriptions/:id
   */
  static async update(req, res) {
    const { id } = req.params
    const { diagnosis, medications, status, notes, follow_up_date, refills_remaining } = req.body
    const { dbTransaction } = req

    try {
      // Validate medications if provided
      if (medications) {
        if (!Array.isArray(medications) || medications.length === 0) {
          return res.status(400).json({ success: false, error: "At least one medication is required" })
        }

        for (const medication of medications) {
          const requiredFields = ["name", "dosage", "frequency", "duration", "instructions", "quantity"]
          for (const field of requiredFields) {
            if (!medication[field]) {
              return res.status(400).json({
                success: false,
                error: `Medication ${field} is required`,
              })
            }
          }
          if (medication.quantity < 1) {
            return res.status(400).json({
              success: false,
              error: "Medication quantity must be at least 1",
            })
          }
        }
      }

      // Validate status if provided
      if (status && !["active", "completed", "cancelled", "expired"].includes(status)) {
        return res.status(400).json({ success: false, error: "Invalid status value" })
      }

      // Check authorization and get current prescription
      const prescriptionCheck = await dbTransaction.query(
        `SELECT p.*, u.full_name as patient_name 
         FROM prescriptions p 
         JOIN users u ON p.patient_id = u.id 
         WHERE p.id = $1`,
        [id],
      )

      if (!prescriptionCheck.rows.length) {
        return res.status(404).json({ success: false, error: "Prescription not found" })
      }

      const currentPrescription = prescriptionCheck.rows[0]

      // Authorization checks
      if (req.user.role === "doctor" && currentPrescription.doctor_id !== req.user.id) {
        return res.status(403).json({ success: false, error: "You can only update your own prescriptions" })
      }

      if (req.user.role === "patient") {
        return res.status(403).json({ success: false, error: "Patients cannot update prescriptions" })
      }

      if (req.user.role === "clinic_admin") {
        const clinicCheck = await dbTransaction.query(
          "SELECT 1 FROM admin_clinics WHERE admin_id = $1 AND clinic_id = $2",
          [req.user.id, currentPrescription.clinic_id],
        )
        if (clinicCheck.rows.length === 0) {
          return res.status(403).json({ success: false, error: "You can only update prescriptions from your clinic" })
        }
      }

      // Prevent updating cancelled prescriptions
      if (currentPrescription.status === "cancelled") {
        return res.status(400).json({ success: false, error: "Cannot update cancelled prescriptions" })
      }

      // Build update query dynamically
      const updateFields = []
      const updateValues = []
      let paramCount = 1

      if (diagnosis !== undefined) {
        updateFields.push(`diagnosis = $${paramCount}`)
        updateValues.push(diagnosis)
        paramCount++
      }

      if (medications !== undefined) {
        updateFields.push(`medication = $${paramCount}`)
        updateValues.push(JSON.stringify(medications)) // Ensure proper JSON stringification
        paramCount++
      }

      if (status !== undefined) {
        updateFields.push(`status = $${paramCount}`)
        updateValues.push(status)
        paramCount++
      }

      if (notes !== undefined) {
        updateFields.push(`notes = $${paramCount}`)
        updateValues.push(notes)
        paramCount++
      }

      if (follow_up_date !== undefined) {
        updateFields.push(`follow_up_date = $${paramCount}`)
        updateValues.push(follow_up_date)
        paramCount++
      }

      if (refills_remaining !== undefined) {
        updateFields.push(`refills_remaining = $${paramCount}`)
        updateValues.push(refills_remaining)
        paramCount++
      }

      if (updateFields.length === 0) {
        return res.status(400).json({ success: false, error: "No fields to update" })
      }

      updateFields.push(`updated_at = NOW()`)
      updateValues.push(id)

      const updateQuery = `
        UPDATE prescriptions 
        SET ${updateFields.join(", ")}
        WHERE id = $${paramCount}
        RETURNING *
      `

      const result = await dbTransaction.query(updateQuery, updateValues)

      if (!result.rows.length) {
        return res.status(404).json({ success: false, error: "Prescription not found" })
      }

      await dbTransaction.commit()

      const prescription = result.rows[0]

      // Parse medications safely
      try {
        if (typeof prescription.medication === "string") {
          prescription.medications = JSON.parse(prescription.medication)
        } else if (Array.isArray(prescription.medication)) {
          prescription.medications = prescription.medication
        } else {
          prescription.medications = []
        }
      } catch (e) {
        logger.error(`Error parsing medication JSON for prescription ${id}: ${e.message}`)
        prescription.medications = medications || []
      }

      prescription.patient_name = currentPrescription.patient_name

      // Create notification for status changes
      if (status && status !== currentPrescription.status) {
        await createNotification(
          currentPrescription.patient_id,
          `Your prescription status has been updated to ${status}`,
          "prescription_updated",
          prescription.id,
        )
      }

      logger.info(`Prescription ${id} updated by ${req.user.role} ${req.user.id}`)

      // Notifications for prescription update
      await NotificationController.createNotification({
        userId: prescription.patient_id,
        message: `Your prescription has been updated by Dr. ${req.user.full_name}`,
        type: "prescription",
        priority: "normal",
        refId: prescription.id
      })

      res.status(200).json({
        success: true,
        data: prescription,
        notifications: "Created for patient"
      })
    } catch (err) {
      if (dbTransaction) {
        await dbTransaction.rollback()
      }
      logger.error(`Update prescription error: ${err.message}`)
      res.status(500).json({ success: false, error: "Server error", details: err.message })
    }
  }

  /**
   * Delete (cancel) a prescription
   * DELETE /api/prescriptions/:id
   */
  static async delete(req, res) {
    const { id } = req.params
    const { dbTransaction } = req

    try {
      const prescriptionCheck = await dbTransaction.query(
        `SELECT p.*, u.full_name as patient_name 
         FROM prescriptions p 
         JOIN users u ON p.patient_id = u.id 
         WHERE p.id = $1`,
        [id],
      )

      if (!prescriptionCheck.rows.length) {
        return res.status(404).json({ success: false, error: "Prescription not found" })
      }

      const prescription = prescriptionCheck.rows[0]

      // Authorization checks
      if (req.user.role === "doctor" && prescription.doctor_id !== req.user.id) {
        return res.status(403).json({ success: false, error: "You can only cancel your own prescriptions" })
      }

      if (req.user.role === "patient") {
        return res.status(403).json({ success: false, error: "Patients cannot cancel prescriptions" })
      }

      if (req.user.role === "clinic_admin") {
        const clinicCheck = await dbTransaction.query(
          "SELECT 1 FROM admin_clinics WHERE admin_id = $1 AND clinic_id = $2",
          [req.user.id, prescription.clinic_id],
        )
        if (clinicCheck.rows.length === 0) {
          return res.status(403).json({ success: false, error: "You can only cancel prescriptions from your clinic" })
        }
      }

      if (prescription.status === "cancelled") {
        return res.status(400).json({ success: false, error: "Prescription is already cancelled" })
      }

      const result = await dbTransaction.query(
        "UPDATE prescriptions SET status = 'cancelled', updated_at = NOW() WHERE id = $1 RETURNING *",
        [id],
      )

      await dbTransaction.commit()

      const updatedPrescription = result.rows[0]

      // Parse medications safely
      try {
        if (typeof updatedPrescription.medication === "string") {
          updatedPrescription.medications = JSON.parse(updatedPrescription.medication)
        } else if (Array.isArray(updatedPrescription.medication)) {
          updatedPrescription.medications = updatedPrescription.medication
        } else {
          updatedPrescription.medications = []
        }
      } catch (e) {
        logger.error(`Error parsing medication JSON for cancelled prescription ${id}: ${e.message}`)
        updatedPrescription.medications = []
      }

      updatedPrescription.patient_name = prescription.patient_name

      // Create notification
      await createNotification(
        prescription.patient_id,
        `Your prescription has been cancelled`,
        "prescription_cancelled",
        prescription.id,
      )

      logger.info(`Prescription ${id} cancelled by ${req.user.role} ${req.user.id}`)

      // Notifications for prescription deletion
      await NotificationController.createNotification({
        userId: prescription.patient_id,
        message: `Prescription ${prescription.prescription_number} has been deleted`,
        type: "prescription",
        priority: "high",
        refId: id
      })

      await NotificationController.createNotification({
        userId: prescription.doctor_id,
        message: `Prescription ${prescription.prescription_number} for patient has been deleted`,
        type: "prescription",
        priority: "normal",
        refId: id
      })

      res.status(200).json({
        success: true,
        message: "Prescription cancelled successfully",
        data: updatedPrescription,
        notifications: "Created for patient and doctor"
      })
    } catch (err) {
      if (dbTransaction) {
        await dbTransaction.rollback()
      }
      logger.error(`Delete prescription error: ${err.message}`)
      res.status(500).json({ success: false, error: "Server error", details: err.message })
    }
  }

  /**
   * Request a refill for a prescription
   * POST /api/prescriptions/:id/refill
   */
  static async requestRefill(req, res) {
    const { id } = req.params
    const { dbTransaction } = req

    try {
      // Check if prescription exists and belongs to the patient
      const prescriptionCheck = await dbTransaction.query(
        `SELECT p.*, u.full_name as doctor_name 
         FROM prescriptions p 
         JOIN users u ON p.doctor_id = u.id 
         WHERE p.id = $1 AND p.patient_id = $2 AND p.status = 'active'`,
        [id, req.user.id],
      )

      if (!prescriptionCheck.rows.length) {
        return res.status(404).json({ success: false, error: "Active prescription not found" })
      }

      const prescription = prescriptionCheck.rows[0]

      // Check if refills are available
      if (prescription.refills_remaining <= 0) {
        return res.status(400).json({ success: false, error: "No refills remaining" })
      }

      // Decrease refill count
      const result = await dbTransaction.query(
        "UPDATE prescriptions SET refills_remaining = refills_remaining - 1, updated_at = NOW() WHERE id = $1 RETURNING *",
        [id],
      )

      await dbTransaction.commit()

      const updatedPrescription = result.rows[0]

      // Parse medications safely
      try {
        if (typeof updatedPrescription.medication === "string") {
          updatedPrescription.medications = JSON.parse(updatedPrescription.medication)
        } else if (Array.isArray(updatedPrescription.medication)) {
          updatedPrescription.medications = updatedPrescription.medication
        } else {
          updatedPrescription.medications = []
        }
      } catch (e) {
        logger.error(`Error parsing medication JSON for refill prescription ${id}: ${e.message}`)
        updatedPrescription.medications = []
      }

      // Create notification for doctor
      await createNotification(
        prescription.doctor_id,
        `Refill requested for prescription #${prescription.prescription_number} by ${req.user.full_name}`,
        "refill_requested",
        prescription.id,
      )

      logger.info(`Refill requested for prescription ${id} by patient ${req.user.id}`)

      // Notification for doctor about refill request
      await NotificationController.createNotification({
        userId: prescription.doctor_id,
        message: `Refill requested for prescription by ${req.user.full_name}`,
        type: "prescription",
        priority: "high",
        refId: prescription.id
      })

      // Notification for patient about refill request status
      await NotificationController.createNotification({
        userId: prescription.patient_id,
        message: `Refill request submitted for your prescription`,
        type: "prescription",
        priority: "normal",
        refId: prescription.id
      })

      res.status(200).json({
        success: true,
        message: "Refill request processed successfully",
        data: updatedPrescription,
        notifications: "Created for doctor and patient"
      })
    } catch (err) {
      if (dbTransaction) {
        await dbTransaction.rollback()
      }
      logger.error(`Request refill error: ${err.message}`)
      res.status(500).json({ success: false, error: "Server error", details: err.message })
    }
  }

  /**
   * Generate and download a prescription as PDF
   * GET /api/prescriptions/:id/download
   */
  static async downloadPDF(req, res) {
    const { id } = req.params

    try {
      // Validate prescription ID
      if (!id || isNaN(Number.parseInt(id))) {
        return res.status(400).json({ success: false, error: "Invalid prescription ID" })
      }

      // Fetch prescription details with all related information
      const prescriptionResult = await executeQuery(
        `SELECT p.*, 
        u1.full_name AS patient_name,
        u1.email AS patient_email,
        u1.phone AS patient_phone,
        pm.allergies AS patient_allergies,
        u2.full_name AS doctor_name,
        u2.email AS doctor_email,
        u2.phone AS doctor_phone,
        u2.specialization AS doctor_specialization,
        u2.license_number AS doctor_license,
        c.name AS clinic_name,
        c.address AS clinic_address,
        c.phone AS clinic_phone
 FROM prescriptions p 
 JOIN users u1 ON p.patient_id = u1.id 
 JOIN users u2 ON p.doctor_id = u2.id 
 LEFT JOIN clinics c ON p.clinic_id = c.id 
 LEFT JOIN patient_medical_profiles pm ON p.patient_id = pm.patient_id
 WHERE p.id = $1`,
        [id],
      )

      if (!prescriptionResult.rows.length) {
        return res.status(404).json({ success: false, error: "Prescription not found" })
      }

      const prescription = prescriptionResult.rows[0]

      // Authorization check
      let canAccess = false
      if (req.user.role === "patient") {
        canAccess = prescription.patient_id === req.user.id
      } else if (req.user.role === "doctor") {
        canAccess = prescription.doctor_id === req.user.id
      } else if (req.user.role === "clinic_admin") {
        const clinicCheck = await executeQuery("SELECT 1 FROM admin_clinics WHERE admin_id = $1 AND clinic_id = $2", [
          req.user.id,
          prescription.clinic_id,
        ])
        canAccess = clinicCheck.rows.length > 0
      } else if (req.user.role === "platform_admin") {
        canAccess = true
      }

      if (!canAccess) {
        return res.status(403).json({ success: false, error: "Unauthorized access to prescription" })
      }

      // CRITICAL: Validate prescription has minimum required data BEFORE creating PDF
      if (!prescription.patient_name || !prescription.doctor_name) {
        logger.error(
          `Prescription ${id} missing required data: patient_name=${prescription.patient_name}, doctor_name=${prescription.doctor_name}`,
        )
        return res.status(400).json({
          success: false,
          error: "Prescription missing required patient or doctor information",
        })
      }

      // Parse medications safely and validate
      let medications = []
      try {
        if (typeof prescription.medication === "string") {
          medications = JSON.parse(prescription.medication)
        } else if (Array.isArray(prescription.medication)) {
          medications = prescription.medication
        }
        if (!Array.isArray(medications)) {
          medications = [medications].filter(Boolean)
        }
      } catch (e) {
        logger.error(`Error parsing medication JSON for PDF: ${e.message}`)
        medications = []
      }

      // CRITICAL: Require either medications or diagnosis - don't create empty PDFs
      if (medications.length === 0 && !prescription.diagnosis) {
        logger.error(`Prescription ${id} has no medications and no diagnosis`)
        return res.status(400).json({
          success: false,
          error: "Cannot generate PDF: Prescription must contain either medications or diagnosis",
        })
      }

      // Parse allergies
      let allergies = []
      if (prescription.patient_allergies) {
        try {
          if (typeof prescription.patient_allergies === "string") {
            allergies = JSON.parse(prescription.patient_allergies)
          } else if (Array.isArray(prescription.patient_allergies)) {
            allergies = prescription.patient_allergies
          }
        } catch (e) {
          allergies = prescription.patient_allergies
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        }
      }

      // Create PDF document
      const doc = new PDFDocument({ size: "A4", margin: 40 })
      const filename = `prescription_${id}_${Date.now()}.pdf`

      // Set response headers BEFORE any potential errors
      res.setHeader("Content-Type", "application/pdf")
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate")
      res.setHeader("Pragma", "no-cache")
      res.setHeader("Expires", "0")

      // Handle PDF generation errors
      let hasErrored = false
      doc.on("error", (error) => {
        hasErrored = true
        logger.error(`PDF generation error: ${error.message}`)
        if (!res.headersSent) {
          res.status(500).json({ success: false, error: "PDF generation failed" })
        }
      })

      // Pipe PDF to response ONLY after validation passes
      doc.pipe(res)

      try {
        // Generate PDF content with validated data
        generatePrescriptionPDF(doc, prescription, medications, allergies)

        // End the document
        doc.end()

        logger.info(`Prescription ${id} PDF generated successfully by ${req.user.role} ${req.user.id}`)
      } catch (pdfError) {
        hasErrored = true
        logger.error(`PDF content generation error: ${pdfError.message}`)
        if (!res.headersSent) {
          res.status(500).json({ success: false, error: "PDF content generation failed" })
        }
      }
    } catch (err) {
      logger.error(`Download prescription error: ${err.message}`)
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: "Server error", details: err.message })
      }
    }
  }

  /**
   * Print a prescription (returns HTML for printing)
   * GET /api/prescriptions/:id/print
   */
  static async printPrescription(req, res) {
    const { id } = req.params

    try {
      // Fetch prescription details
      const prescriptionResult = await executeQuery(
        `SELECT p.*, 
        u1.full_name AS patient_name,
        u1.email AS patient_email,
        u1.phone AS patient_phone,
        pm.allergies AS patient_allergies,
        u2.full_name AS doctor_name,
        u2.email AS doctor_email,
        u2.phone AS doctor_phone,
        u2.specialization AS doctor_specialization,
        u2.license_number AS doctor_license,
        c.name AS clinic_name,
        c.address AS clinic_address,
        c.phone AS clinic_phone
 FROM prescriptions p 
 JOIN users u1 ON p.patient_id = u1.id 
 JOIN users u2 ON p.doctor_id = u2.id 
 LEFT JOIN clinics c ON p.clinic_id = c.id 
 LEFT JOIN patient_medical_profiles pm ON p.patient_id = pm.patient_id
 WHERE p.id = $1`,
        [id],
      )

      if (!prescriptionResult.rows.length) {
        return res.status(404).json({ success: false, error: "Prescription not found" })
      }

      const prescription = prescriptionResult.rows[0]

      // Authorization check
      let canAccess = false
      if (req.user.role === "patient") {
        canAccess = prescription.patient_id === req.user.id
      } else if (req.user.role === "doctor") {
        canAccess = prescription.doctor_id === req.user.id
      } else if (req.user.role === "clinic_admin") {
        const clinicCheck = await executeQuery("SELECT 1 FROM admin_clinics WHERE admin_id = $1 AND clinic_id = $2", [
          req.user.id,
          prescription.clinic_id,
        ])
        canAccess = clinicCheck.rows.length > 0
      } else if (req.user.role === "platform_admin") {
        canAccess = true
      }

      if (!canAccess) {
        return res.status(403).json({ success: false, error: "Unauthorized access to prescription" })
      }

      // Parse medications JSON safely
      let medications = []
      try {
        if (typeof prescription.medication === "string") {
          medications = JSON.parse(prescription.medication)
        } else if (Array.isArray(prescription.medication)) {
          medications = prescription.medication
        }
        if (!Array.isArray(medications)) {
          medications = [medications].filter(Boolean)
        }
      } catch (e) {
        logger.error(`Error parsing medication JSON for print: ${e.message}`)
        medications = []
      }

      // Return print-ready HTML
      const printHTML = generatePrintHTML(prescription, medications)
      res.setHeader("Content-Type", "text/html")
      res.send(printHTML)

      logger.info(`Prescription ${id} print view accessed by ${req.user.role} ${req.user.id}`)
    } catch (err) {
      logger.error(`Print prescription error: ${err.message}`)
      res.status(500).json({ success: false, error: "Server error", details: err.message })
    }
  }
  /**
   * Get prescriptions by patient ID (for doctors/admins)
   * GET /api/prescriptions/patient/:patientId
   */
  static async getByPatient(req, res) {
    const { patientId } = req.params
    const { status, limit = 50, offset = 0 } = req.query

    try {
      // Authorization check
      if (!["doctor", "clinic_admin", "platform_admin"].includes(req.user.role)) {
        return res.status(403).json({ success: false, error: "Unauthorized access to patient prescriptions" })
      }

      let whereCondition = "WHERE p.patient_id = $1"
      const params = [patientId]
      let paramCount = 2

      // Add status filter if provided
      if (status) {
        whereCondition += ` AND p.status = $${paramCount}`
        params.push(status)
        paramCount++
      }

      // Add clinic restriction for clinic admins
      if (req.user.role === "clinic_admin") {
        whereCondition += ` AND p.clinic_id IN (SELECT clinic_id FROM admin_clinics WHERE admin_id = $${paramCount})`
        params.push(req.user.id)
        paramCount++
      }

      const query = `
        SELECT p.*, 
               u.full_name AS doctor_name,
               c.name AS clinic_name,
               a.created_at AS appointment_date,
               a.type AS appointment_type
        FROM prescriptions p 
        JOIN users u ON p.doctor_id = u.id 
        LEFT JOIN clinics c ON p.clinic_id = c.id 
        LEFT JOIN appointments a ON p.appointment_id = a.id
        ${whereCondition}
        ORDER BY p.created_at DESC
        LIMIT $${paramCount} OFFSET $${paramCount + 1}
      `

      params.push(Number.parseInt(limit), Number.parseInt(offset))
      const result = await executeQuery(query, params)

      // Parse medications JSON for each prescription safely
      const prescriptions = result.rows.map((prescription) => {
        try {
          if (typeof prescription.medication === "string") {
            prescription.medications = JSON.parse(prescription.medication)
          } else if (Array.isArray(prescription.medication)) {
            prescription.medications = prescription.medication
          } else {
            prescription.medications = []
          }
        } catch (e) {
          logger.error(`Error parsing medication JSON for prescription ${prescription.id}: ${e.message}`)
          prescription.medications = []
        }
        return prescription
      })

      res.json({
        success: true,
        data: prescriptions,
      })
    } catch (err) {
      logger.error(`Get prescriptions by patient error: ${err.message}`)
      res.status(500).json({ success: false, error: "Server error", details: err.message })
    }
  }

  /**
   * Get prescription statistics
   * GET /api/prescriptions/stats
   */
  static async getStats(req, res) {
    try {
      let whereCondition = ""
      let params = []

      // Build where condition based on user role
      if (req.user.role === "patient") {
        whereCondition = "WHERE patient_id = $1"
        params = [req.user.id]
      } else if (req.user.role === "doctor") {
        whereCondition = "WHERE doctor_id = $1"
        params = [req.user.id]
      } else if (req.user.role === "clinic_admin") {
        whereCondition = "WHERE clinic_id IN (SELECT clinic_id FROM admin_clinics WHERE admin_id = $1)"
        params = [req.user.id]
      }

      const query = `
        SELECT 
          COUNT(*) as total_prescriptions,
          COUNT(*) FILTER (WHERE status = 'active') as active_prescriptions,
          COUNT(*) FILTER (WHERE status = 'completed') as completed_prescriptions,
          COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled_prescriptions,
          COUNT(*) FILTER (WHERE status = 'expired') as expired_prescriptions,
          COUNT(*) FILTER (WHERE refills_remaining > 0) as prescriptions_with_refills,
          COUNT(*) FILTER (WHERE follow_up_date IS NOT NULL AND follow_up_date > CURRENT_DATE) as pending_followups
        FROM prescriptions 
        ${whereCondition}
      `

      const result = await executeQuery(query, params)
      const stats = result.rows[0]

      // Convert string counts to numbers
      Object.keys(stats).forEach((key) => {
        stats[key] = Number.parseInt(stats[key]) || 0
      })

      res.json({
        success: true,
        data: stats,
      })
    } catch (err) {
      logger.error(`Get prescription stats error: ${err.message}`)
      res.status(500).json({ success: false, error: "Server error", details: err.message })
    }
  }
}

// Helper function to generate prescription number
async function generatePrescriptionNumber(dbTransaction) {
  const year = new Date().getFullYear()
  const month = String(new Date().getMonth() + 1).padStart(2, "0")

  // Get the count of prescriptions this month
  const countResult = await dbTransaction.query(
    `SELECT COUNT(*) as count 
     FROM prescriptions 
     WHERE EXTRACT(YEAR FROM created_at) = $1 
     AND EXTRACT(MONTH FROM created_at) = $2`,
    [year, Number.parseInt(month)],
  )

  const count = Number.parseInt(countResult.rows[0].count) + 1
  const sequence = String(count).padStart(4, "0")

  return `RX${year}${month}${sequence}`
}

// Helper function to create notifications
async function createNotification(userId, message, type, refId = null) {
  try {
    await executeQuery(
      `INSERT INTO notifications (user_id, message, type, ref_id) 
       VALUES ($1, $2, $3, $4)`,
      [userId, message, type, refId],
    )
  } catch (error) {
    logger.error(`Error creating notification: ${error.message}`)
  }
}

// Helper function to generate print-ready HTML
function generatePrintHTML(prescription, medications) {
  return `
<!DOCTYPE html>
<html>
<head>
    <title>Prescription #${prescription.prescription_number}</title>
    <style>
        @media print {
            body { margin: 0; }
            .no-print { display: none; }
        }
        body {
            font-family: Arial, sans-serif;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            line-height: 1.6;
        }
        .header {
            text-align: center;
            border-bottom: 2px solid #333;
            padding-bottom: 20px;
            margin-bottom: 30px;
        }
        .clinic-info {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 5px;
            margin-bottom: 20px;
        }
        .prescription-info {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 30px;
        }
        .section {
            margin-bottom: 25px;
        }
        .section h3 {
            color: #333;
            border-bottom: 1px solid #ddd;
            padding-bottom: 5px;
        }
        .medication {
            border: 1px solid #ddd;
            padding: 15px;
            margin-bottom: 15px;
            border-radius: 5px;
        }
        .medication-header {
            font-weight: bold;
            font-size: 1.1em;
            color: #2c3e50;
            margin-bottom: 10px;
        }
        .medication-details {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 10px;
            margin-bottom: 10px;
        }
        .detail-item {
            font-size: 0.9em;
        }
        .detail-label {
            font-weight: bold;
            color: #666;
        }
        .signature-section {
            margin-top: 50px;
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 50px;
        }
        .signature-line {
            border-bottom: 1px solid #333;
            height: 40px;
            margin-bottom: 5px;
        }
        .print-button {
            background: #007bff;
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 5px;
            cursor: pointer;
            margin-bottom: 20px;
        }
        @media print {
            .print-button { display: none; }
        }
    </style>
</head>
<body>
    <button class="print-button no-print" onclick="window.print()">Print Prescription</button>
    
    <div class="header">
        <h1>PRESCRIPTION</h1>
        <p><strong>Prescription #:</strong> ${prescription.prescription_number || prescription.id}</p>
        <p><strong>Date:</strong> ${new Date(prescription.created_at).toLocaleDateString()}</p>
    </div>

    <div class="clinic-info">
        <h2>${prescription.clinic_name || "Healthcare Clinic"}</h2>
        <p>${prescription.clinic_address || "Address not provided"}</p>
        <p><strong>Phone:</strong> ${prescription.clinic_phone || "N/A"}</p>
    </div>

    <div class="prescription-info">
        <div class="section">
            <h3>Patient Information</h3>
            <p><strong>Name:</strong> ${prescription.patient_name}</p>
            <p><strong>Email:</strong> ${prescription.patient_email || "N/A"}</p>
            <p><strong>Phone:</strong> ${prescription.patient_phone || "N/A"}</p>
        </div>

        <div class="section">
            <h3>Prescribing Doctor</h3>
            <p><strong>Name:</strong> Dr. ${prescription.doctor_name}</p>
            <p><strong>Email:</strong> ${prescription.doctor_email || "N/A"}</p>
            <p><strong>Phone:</strong> ${prescription.doctor_phone || "N/A"}</p>
            ${prescription.doctor_license ? `<p><strong>License:</strong> ${prescription.doctor_license}</p>` : ""}
        </div>
    </div>

    <div class="section">
        <h3>Diagnosis</h3>
        <p>${prescription.diagnosis}</p>
    </div>

    <div class="section">
        <h3>Medications</h3>
        ${medications
          .map(
            (med) => `
            <div class="medication">
                <div class="medication-header">${med.name}</div>
                <div class="medication-details">
                    <div class="detail-item">
                        <span class="detail-label">Dosage:</span> ${med.dosage}
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Frequency:</span> ${med.frequency}
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Duration:</span> ${med.duration}
                    </div>
                    <div class="detail-item">
                        <span class="detail-label">Quantity:</span> ${med.quantity || "N/A"}
                    </div>
                </div>
                <div class="detail-item">
                    <span class="detail-label">Instructions:</span> ${med.instructions}
                </div>
            </div>
        `,
          )
          .join("")}
    </div>

    ${
      prescription.notes
        ? `
        <div class="section">
            <h3>Additional Notes</h3>
            <p>${prescription.notes}</p>
        </div>
    `
        : ""
    }

    ${
      prescription.refills_remaining > 0
        ? `
        <div class="section">
            <h3>Refills</h3>
            <p><strong>Refills Remaining:</strong> ${prescription.refills_remaining}</p>
        </div>
    `
        : ""
    }

    <div class="signature-section">
        <div>
            <div class="signature-line"></div>
            <p><strong>Doctor's Signature</strong></p>
            <p>Dr. ${prescription.doctor_name}</p>
        </div>
        <div>
            <div class="signature-line"></div>
            <p><strong>Date</strong></p>
            <p>${new Date().toLocaleDateString()}</p>
        </div>
    </div>

    <div style="text-align: center; margin-top: 30px; font-size: 0.8em; color: #666;">
        <p>CONFIDENTIAL - FOR PATIENT AND PHARMACY USE ONLY</p>
    </div>

    <script>
        // Auto-print when opened in new window
        if (window.location.search.includes('print=true')) {
            window.onload = function() {
                setTimeout(function() {
                    window.print();
                }, 500);
            }
        }
    </script>
</body>
</html>
  `
}

function generatePrescriptionPDF(doc, prescription, medications, allergies) {
  try {
    // Validate required data before generating PDF
    if (!prescription) {
      throw new Error("Prescription data is required")
    }

    if (!prescription.patient_name || !prescription.doctor_name) {
      throw new Error("Patient and doctor information is required")
    }

    // Ensure medications is an array
    if (!Array.isArray(medications)) {
      medications = []
    }

    // CRITICAL: Don't generate PDF if no content
    if (medications.length === 0 && !prescription.diagnosis) {
      throw new Error("Cannot generate PDF: Prescription must have either medications or diagnosis")
    }

    // Use only built-in fonts - no custom font loading

    // Add a border to the entire page
    doc
      .rect(20, 20, doc.page.width - 40, doc.page.height - 40)
      .lineWidth(1)
      .stroke("#333333")

    // Header with clinic info
    doc.rect(40, 40, doc.page.width - 80, 100).fillAndStroke("#f8f9fa", "#e9ecef")

    // Logo placeholder
    doc.circle(80, 70, 25).lineWidth(1).fillAndStroke("#e9ecef", "#6c757d")
    doc.fontSize(12).fillColor("#6c757d").text("LOGO", 65, 65)

    // Clinic info
    doc
      .fontSize(18)
      .fillColor("#212529")
      .text(`${prescription.clinic_name || "Healthcare Clinic"}`, 120, 50, { width: 300 })
    doc
      .fontSize(10)
      .fillColor("#495057")
      .text(`${prescription.clinic_address || "No address provided"}`, 120, 75)
    doc.text(`Phone: ${prescription.clinic_phone || "N/A"}`, 120, 90)

    // Prescription title banner
    doc.rect(40, 150, doc.page.width - 80, 30).fillAndStroke("#4263eb", "#364fc7")
    doc
      .fontSize(14)
      .fillColor("white")
      .text("PRESCRIPTION", doc.page.width / 2 - 50, 158)

    // Prescription details
    doc
      .fontSize(8)
      .fillColor("#6c757d")
      .text(`Prescription #: ${prescription.prescription_number || prescription.id}`, 40, 190)
      .text(`Date: ${new Date(prescription.created_at).toLocaleDateString()}`, doc.page.width - 150, 190)

    // Patient & Doctor Info
    doc.rect(40, 210, (doc.page.width - 90) / 2, 120).fillAndStroke("#f8f9fa", "#e9ecef")
    doc
      .rect(40 + (doc.page.width - 90) / 2 + 10, 210, (doc.page.width - 90) / 2, 120)
      .fillAndStroke("#f8f9fa", "#e9ecef")

    // Patient info
    doc.fontSize(12).fillColor("#212529").text("PATIENT INFORMATION", 50, 220)
    doc
      .fontSize(10)
      .fillColor("#495057")
      .text(`Name: ${prescription.patient_name}`, 50, 240)
      .text(`Email: ${prescription.patient_email || "N/A"}`, 50, 260)
      .text(`Phone: ${prescription.patient_phone || "N/A"}`, 50, 280)

    // Allergies warning if present
    if (allergies && allergies.length > 0) {
      doc.fontSize(9).fillColor("#dc2626").text("ALLERGIES:", 50, 300)
      doc
        .fontSize(8)
        .fillColor("#dc2626")
        .text(allergies.join(", "), 50, 315, { width: (doc.page.width - 90) / 2 - 20 })
    }

    // Doctor info
    doc
      .fontSize(12)
      .fillColor("#212529")
      .text("PRESCRIBING DOCTOR", 50 + (doc.page.width - 90) / 2 + 10, 220)
    doc
      .fontSize(10)
      .fillColor("#495057")
      .text(`Name: Dr. ${prescription.doctor_name}`, 50 + (doc.page.width - 90) / 2 + 10, 240)
      .text(`Email: ${prescription.doctor_email || "N/A"}`, 50 + (doc.page.width - 90) / 2 + 10, 260)
      .text(`Phone: ${prescription.doctor_phone || "N/A"}`, 50 + (doc.page.width - 90) / 2 + 10, 280)

    if (prescription.doctor_license) {
      doc.text(`License: ${prescription.doctor_license}`, 50 + (doc.page.width - 90) / 2 + 10, 300)
    }

    // Diagnosis - ALWAYS show this section
    doc.fontSize(14).fillColor("#212529").text("DIAGNOSIS", 40, 350)
    doc
      .fontSize(12)
      .fillColor("#495057")
      .text(prescription.diagnosis || "No specific diagnosis provided", 40, 370)

    // Medication Details - only if medications exist
    if (medications.length > 0) {
      doc.fontSize(14).fillColor("#212529").text("PRESCRIBED MEDICATIONS", 40, 400)

      // Table headers
      const tableTop = 430
      doc.rect(40, tableTop, doc.page.width - 80, 25).fillAndStroke("#e9ecef", "#ced4da")

      doc
        .fontSize(10)
        .fillColor("#212529")
        .text("MEDICATION", 50, tableTop + 8)
        .text("DOSAGE", 180, tableTop + 8)
        .text("FREQUENCY", 280, tableTop + 8)
        .text("DURATION", 380, tableTop + 8)
        .text("QTY", 480, tableTop + 8)

      // Table rows for each medication
      let yPos = tableTop + 30

      medications.forEach((med, index) => {
        // Alternating row colors
        if (index % 2 === 0) {
          doc.rect(40, yPos - 5, doc.page.width - 80, 25).fillAndStroke("#f8f9fa", "#f8f9fa")
        }

        doc
          .fontSize(10)
          .fillColor("#212529")
          .text(med.name || "N/A", 50, yPos)
          .text(med.dosage || "N/A", 180, yPos)
          .text(med.frequency || "N/A", 280, yPos)
          .text(med.duration || "N/A", 380, yPos)
          .text(med.quantity || "N/A", 480, yPos)

        // Instructions on next line
        yPos += 15
        doc
          .fontSize(8)
          .fillColor("#6c757d")
          .text(`Instructions: ${med.instructions || "No special instructions"}`, 50, yPos)

        yPos += 20
      })
    } else {
      // Show message when no medications
      doc.fontSize(14).fillColor("#212529").text("MEDICATIONS", 40, 400)
      doc.fontSize(12).fillColor("#6c757d").text("No medications prescribed at this time", 40, 430)
    }

    // Additional Notes
    if (prescription.notes) {
      const notesY = medications.length > 0 ? 500 : 460
      doc.rect(40, notesY, doc.page.width - 80, 60).fillAndStroke("#f8f9fa", "#e9ecef")

      doc
        .fontSize(12)
        .fillColor("#212529")
        .text("ADDITIONAL NOTES", 50, notesY + 10)

      doc
        .fontSize(10)
        .fillColor("#495057")
        .text(prescription.notes, 50, notesY + 30, {
          width: doc.page.width - 100,
          align: "left",
        })
    }

    // Refills information
    if (prescription.refills_remaining > 0) {
      const refillY = medications.length > 0 ? 580 : 540
      doc.fontSize(12).fillColor("#212529").text(`REFILLS REMAINING: ${prescription.refills_remaining}`, 40, refillY)
    }

    // Signature Field
    const signatureY = doc.page.height - 150
    doc.fontSize(12).fillColor("#212529").text("DOCTOR'S SIGNATURE", 40, signatureY)

    doc
      .moveTo(40, signatureY + 40)
      .lineTo(250, signatureY + 40)
      .stroke("#333333")

    doc.text(`Dr. ${prescription.doctor_name}`, 40, signatureY + 45)

    doc
      .moveTo(300, signatureY + 40)
      .lineTo(450, signatureY + 40)
      .stroke("#333333")

    doc.text(`Date: ${new Date().toLocaleDateString()}`, 300, signatureY + 45)

    // Footer
    doc
      .fontSize(8)
      .fillColor("#6c757d")
      .text("CONFIDENTIAL - FOR PATIENT AND PHARMACY USE ONLY", 40, doc.page.height - 50, {
        align: "center",
        width: doc.page.width - 80,
      })
  } catch (error) {
    logger.error(`PDF generation error: ${error.message}`)
    throw error
  }
}

module.exports = PrescriptionController

// Get all prescriptions with pagination and filtering
exports.getAllPrescriptions = asyncHandler(async (req, res) => {
  const { page = 1, limit = 10, status, search, startDate, endDate, patient_id, doctor_id } = req.query

  const offset = (page - 1) * limit
  const params = []

  // Base query
  let query = `
    SELECT p.*, 
      u1.full_name AS patient_name,
      u1.email AS patient_email,
      u2.full_name AS doctor_name,
      u2.email AS doctor_email,
      c.name AS clinic_name
    FROM prescriptions p
    JOIN users u1 ON p.patient_id = u1.id
    JOIN users u2 ON p.doctor_id = u2.id
    LEFT JOIN clinics c ON p.clinic_id = c.id
    WHERE 1=1
  `

  // Add filters
  if (status && status !== "all") {
    query += ` AND p.status = $${params.length + 1}`
    params.push(status)
  }

  if (search) {
    query += ` AND (
      u1.full_name ILIKE $${params.length + 1} OR 
      p.prescription_number ILIKE $${params.length + 1} OR
      p.diagnosis ILIKE $${params.length + 1}
    )`
    params.push(`%${search}%`)
  }

  if (startDate) {
    query += ` AND p.created_at >= $${params.length + 1}`
    params.push(startDate)
  }

  if (endDate) {
    query += ` AND p.created_at <= $${params.length + 1}`
    params.push(endDate)
  }

  if (patient_id) {
    query += ` AND p.patient_id = $${params.length + 1}`
    params.push(patient_id)
  }

  if (doctor_id) {
    query += ` AND p.doctor_id = $${params.length + 1}`
    params.push(doctor_id)
  }

  // Add ordering
  query += ` ORDER BY p.created_at DESC`

  // Count total results for pagination
  const countQuery = `SELECT COUNT(*) FROM (${query}) AS count_query`
  const countResult = await db.query(countQuery, params)
  const total = Number.parseInt(countResult.rows[0].count)

  // Add pagination
  query += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`
  params.push(limit)
  params.push(offset)

  // Execute query
  const result = await db.query(query, params)

  // Process medications JSON
  const prescriptions = result.rows.map((row) => {
    try {
      if (row.medication && typeof row.medication === "string") {
        row.medications = JSON.parse(row.medication)
      } else if (row.medication) {
        row.medications = row.medication
      } else {
        row.medications = []
      }
    } catch (e) {
      console.error("Error parsing medication JSON:", e)
      row.medications = []
    }
    return row
  })

  res.json({
    success: true,
    prescriptions,
    pagination: {
      total,
      page: Number.parseInt(page),
      limit: Number.parseInt(limit),
      pages: Math.ceil(total / limit),
    },
  })
})

// Get prescription by ID
exports.getPrescriptionById = asyncHandler(async (req, res) => {
  const { id } = req.params

  // Get prescription with patient and doctor details
  const query = `
    SELECT p.*, 
      u1.full_name AS patient_name,
      u1.email AS patient_email,
      u1.phone AS patient_phone,
      pm.allergies AS patient_allergies,
      u2.full_name AS doctor_name,
      u2.email AS doctor_email,
      u2.phone AS doctor_phone,
      u2.specialization AS doctor_specialization,
      u2.license_number AS doctor_license,
      c.name AS clinic_name,
      c.address AS clinic_address,
      c.phone AS clinic_phone
    FROM prescriptions p
    JOIN users u1 ON p.patient_id = u1.id
    JOIN users u2 ON p.doctor_id = u2.id
    LEFT JOIN clinics c ON p.clinic_id = c.id
    LEFT JOIN patient_medical_profiles pm ON p.patient_id = pm.patient_id
    WHERE p.id = $1
  `

  const result = await db.query(query, [id])

  if (result.rows.length === 0) {
    return res.status(404).json({
      success: false,
      message: "Prescription not found",
    })
  }

  const prescription = result.rows[0]

  // Parse medication JSON
  try {
    if (prescription.medication && typeof prescription.medication === "string") {
      prescription.medications = JSON.parse(prescription.medication)
    } else if (prescription.medication) {
      prescription.medications = prescription.medication
    } else {
      prescription.medications = []
    }
  } catch (e) {
    console.error("Error parsing medication JSON:", e)
    prescription.medications = []
  }

  res.json({
    success: true,
    prescription,
  })
})

// Create new prescription
exports.createPrescription = asyncHandler(async (req, res) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      errors: errors.array(),
    })
  }

  const {
    patient_id,
    clinic_id,
    appointment_id,
    diagnosis,
    medications,
    notes,
    follow_up_date,
    refills_remaining = 0,
  } = req.body

  // Get doctor ID from authenticated user
  const doctor_id = req.user.id

  // Generate prescription number
  const prescriptionNumber = `RX${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, "0")}${String(Date.now()).slice(-5)}`

  // Convert medications to JSON string
  const medicationJson = JSON.stringify(medications)

  // Insert prescription
  const query = `
    INSERT INTO prescriptions (
      prescription_number,
      patient_id,
      doctor_id,
      clinic_id,
      appointment_id,
      diagnosis,
      medication,
      notes,
      follow_up_date,
      refills_remaining,
      status
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *
  `

  const values = [
    prescriptionNumber,
    patient_id,
    doctor_id,
    clinic_id,
    appointment_id || null,
    diagnosis,
    medicationJson,
    notes || null,
    follow_up_date || null,
    refills_remaining,
    "active",
  ]

  const result = await db.query(query, values)
  const prescription = result.rows[0]

  // Add medications array to response
  prescription.medications = medications

  res.status(201).json({
    success: true,
    message: "Prescription created successfully",
    prescription,
  })
})

// Update prescription
exports.updatePrescription = asyncHandler(async (req, res) => {
  const { id } = req.params
  const { diagnosis, medications, notes, follow_up_date, refills_remaining, status } = req.body

  // Check if prescription exists and belongs to the doctor
  const checkQuery = `
    SELECT * FROM prescriptions 
    WHERE id = $1 AND doctor_id = $2
  `

  const checkResult = await db.query(checkQuery, [id, req.user.id])

  if (checkResult.rows.length === 0) {
    return res.status(404).json({
      success: false,
      message: "Prescription not found or you do not have permission to update it",
    })
  }

  // Build update query dynamically
  let updateQuery = "UPDATE prescriptions SET updated_at = NOW()"
  const values = []
  let paramCount = 1

  if (diagnosis !== undefined) {
    updateQuery += `, diagnosis = $${paramCount++}`
    values.push(diagnosis)
  }

  if (medications !== undefined) {
    updateQuery += `, medication = $${paramCount++}`
    values.push(JSON.stringify(medications))
  }

  if (notes !== undefined) {
    updateQuery += `, notes = $${paramCount++}`
    values.push(notes)
  }

  if (follow_up_date !== undefined) {
    updateQuery += `, follow_up_date = $${paramCount++}`
    values.push(follow_up_date)
  }

  if (refills_remaining !== undefined) {
    updateQuery += `, refills_remaining = $${paramCount++}`
    values.push(refills_remaining)
  }

  if (status !== undefined) {
    updateQuery += `, status = $${paramCount++}`
    values.push(status)
  }

  updateQuery += ` WHERE id = $${paramCount++} RETURNING *`
  values.push(id)

  // Execute update
  const result = await db.query(updateQuery, values)
  const updatedPrescription = result.rows[0]

  // Parse medication JSON for response
  try {
    if (updatedPrescription.medication && typeof updatedPrescription.medication === "string") {
      updatedPrescription.medications = JSON.parse(updatedPrescription.medication)
    } else if (updatedPrescription.medication) {
      updatedPrescription.medications = updatedPrescription.medication
    } else {
      updatedPrescription.medications = []
    }
  } catch (e) {
    console.error("Error parsing medication JSON:", e)
    updatedPrescription.medications = []
  }

  res.json({
    success: true,
    message: "Prescription updated successfully",
    prescription: updatedPrescription,
  })
})

// Delete/Cancel prescription
exports.deletePrescription = asyncHandler(async (req, res) => {
  const { id } = req.params

  // Check if prescription exists and belongs to the doctor
  const checkQuery = `
    SELECT * FROM prescriptions 
    WHERE id = $1 AND doctor_id = $2
  `

  const checkResult = await db.query(checkQuery, [id, req.user.id])

  if (checkResult.rows.length === 0) {
    return res.status(404).json({
      success: false,
      message: "Prescription not found or you do not have permission to cancel it",
    })
  }

  // Update status to cancelled instead of deleting
  const updateQuery = `
    UPDATE prescriptions 
    SET status = 'cancelled', updated_at = NOW()
    WHERE id = $1
    RETURNING *
  `

  const result = await db.query(updateQuery, [id])

  res.json({
    success: true,
    message: "Prescription cancelled successfully",
    prescription: result.rows[0],
  })
})

// Generate prescription PDF
exports.generatePrescriptionPDF = asyncHandler(async (req, res) => {
  const { id } = req.params

  // Get prescription with all details
  const query = `
    SELECT p.*, 
      u1.full_name AS patient_name,
      u1.email AS patient_email,
      u1.phone AS patient_phone,
      pm.allergies AS patient_allergies,
      u2.full_name AS doctor_name,
      u2.email AS doctor_email,
      u2.phone AS doctor_phone,
      u2.specialization AS doctor_specialization,
      u2.license_number AS doctor_license,
      c.name AS clinic_name,
      c.address AS clinic_address,
      c.phone AS clinic_phone
    FROM prescriptions p
    JOIN users u1 ON p.patient_id = u1.id
    JOIN users u2 ON p.doctor_id = u2.id
    LEFT JOIN clinics c ON p.clinic_id = c.id
    LEFT JOIN patient_medical_profiles pm ON p.patient_id = pm.patient_id
    WHERE p.id = $1
  `

  try {
    const result = await db.query(query, [id])

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Prescription not found",
      })
    }

    const prescription = result.rows[0]

    // Parse medication JSON
    try {
      if (prescription.medication && typeof prescription.medication === "string") {
        prescription.medications = JSON.parse(prescription.medication)
      } else if (prescription.medication) {
        prescription.medications = prescription.medication
      } else {
        prescription.medications = []
      }
    } catch (e) {
      console.error("Error parsing medication JSON:", e)
      prescription.medications = []
    }

    // Generate PDF using a PDF library (implementation depends on your setup)
    // For example, using PDFKit or html-pdf

    // For now, just return the prescription data
    res.json({
      success: true,
      prescription,
      message: "PDF generation endpoint (implementation required)",
    })
  } catch (error) {
    console.error("Print prescription error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to generate prescription PDF",
      error: error.message,
    })
  }
})

// Print prescription HTML
exports.printPrescription = asyncHandler(async (req, res) => {
  const { id } = req.params

  // Get prescription with all details
  const query = `
    SELECT p.*, 
      u1.full_name AS patient_name,
      u1.email AS patient_email,
      u1.phone AS patient_phone,
      pm.allergies AS patient_allergies,
      u2.full_name AS doctor_name,
      u2.email AS doctor_email,
      u2.phone AS doctor_phone,
      u2.specialization AS doctor_specialization,
      u2.license_number AS doctor_license,
      c.name AS clinic_name,
      c.address AS clinic_address,
      c.phone AS clinic_phone
    FROM prescriptions p
    JOIN users u1 ON p.patient_id = u1.id
    JOIN users u2 ON p.doctor_id = u2.id
    LEFT JOIN clinics c ON p.clinic_id = c.id
    LEFT JOIN patient_medical_profiles pm ON p.patient_id = pm.patient_id
    WHERE p.id = $1
  `

  try {
    const result = await db.query(query, [id])

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Prescription not found",
      })
    }

    const prescription = result.rows[0]

    // Parse medication JSON
    try {
      if (prescription.medication && typeof prescription.medication === "string") {
        prescription.medications = JSON.parse(prescription.medication)
      } else if (prescription.medication) {
        prescription.medications = prescription.medication
      } else {
        prescription.medications = []
      }
    } catch (e) {
      console.error("Error parsing medication JSON:", e)
      prescription.medications = []
    }

    // Return HTML for printing
    res.json({
      success: true,
      prescription,
      message: "Print HTML endpoint (implementation required)",
    })
  } catch (error) {
    console.error("Print prescription error:", error)
    res.status(500).json({
      success: false,
      message: "Failed to generate prescription print view",
      error: error.message,
    })
  }
})
