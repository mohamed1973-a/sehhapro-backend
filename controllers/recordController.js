const { pool } = require("../config/database")
const logger = require("../middleware/logger")

class RecordController {
  static async create(req, res) {
    const { patientId, diagnosis, treatment, notes, appointmentId } = req.body

    try {
      // Input validation
      if (!patientId) {
        return res.status(400).json({ error: "Patient ID is required" })
      }

      await pool.query("BEGIN")

      // Verify patient exists
      const patientCheck = await pool.query(
        "SELECT 1 FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = $1 AND r.name = 'patient'",
        [patientId],
      )

      if (patientCheck.rows.length === 0) {
        await pool.query("ROLLBACK")
        return res.status(404).json({ error: "Patient not found" })
      }

      let clinicId = null

      // If appointmentId is provided, get clinic from appointment
      if (appointmentId) {
        const appointmentCheck = await pool.query(
          "SELECT clinic_id FROM appointments WHERE id = $1 AND (doctor_id = $2 OR $3 = 'clinic_admin')",
          [appointmentId, req.user.id, req.user.role],
        )

        if (appointmentCheck.rows.length === 0) {
          await pool.query("ROLLBACK")
          return res.status(404).json({ error: "Appointment not found or unauthorized" })
        }

        clinicId = appointmentCheck.rows[0].clinic_id
      } else {
        // Get a valid clinic_id from doctor's associations
        const clinicCheck = await pool.query("SELECT clinic_id FROM doctor_clinics WHERE doctor_id = $1 LIMIT 1", [
          req.user.id,
        ])

        if (clinicCheck.rows.length > 0) {
          clinicId = clinicCheck.rows[0].clinic_id
        } else {
          // Fallback to any clinic
          const anyClinicCheck = await pool.query("SELECT id FROM clinics LIMIT 1")
          if (anyClinicCheck.rows.length > 0) {
            clinicId = anyClinicCheck.rows[0].id
          } else {
            await pool.query("ROLLBACK")
            return res.status(400).json({ error: "No clinic found. Please create a clinic first." })
          }
        }
      }

      // Verify clinic exists
      if (clinicId) {
        const clinicCheck = await pool.query("SELECT 1 FROM clinics WHERE id = $1", [clinicId]);
        if (clinicCheck.rows.length === 0) {
          await pool.query("ROLLBACK");
          return res.status(404).json({ error: "Clinic not found" });
        }
      }

      // Add record type validation
      // In the create method, add validation for record_type:

      // Validate record type
      const validRecordTypes = [
        "consultation", "diagnosis", "treatment", "follow_up", 
        "lab_result", "prescription", "vaccination", "allergy", 
        "surgery", "emergency", "referral", "note"
      ];

      const recordType = req.body.recordType || "consultation";

      if (!validRecordTypes.includes(recordType)) {
        await pool.query("ROLLBACK");
        return res.status(400).json({ 
          error: "Invalid record type", 
          validTypes: validRecordTypes 
        });
      }

      // Use the validated record type in the insert query
      const result = await pool.query(
        `INSERT INTO medical_records 
         (patient_id, doctor_id, clinic_id, appointment_id, entry_type, diagnosis, treatment, notes) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
         RETURNING *`,
        [patientId, req.user.id, clinicId, appointmentId, recordType, diagnosis, treatment, notes],
      );

      await pool.query("COMMIT")
      logger.info(`Medical record created for patient: ${patientId}`)
      res.status(201).json({ message: "Record created", record: result.rows[0] })
    } catch (err) {
      await pool.query("ROLLBACK")
      logger.error(`Create record error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  static async getAll(req, res) {
    try {
      let query, params

      if (req.user.role === "patient") {
        query = `
          SELECT mr.*, u.full_name AS doctor_name, c.name AS clinic_name,
                 a.id AS appointment_id, a.type AS appointment_type
          FROM medical_records mr 
          JOIN users u ON mr.doctor_id = u.id
          LEFT JOIN clinics c ON mr.clinic_id = c.id
          LEFT JOIN appointments a ON mr.appointment_id = a.id
          WHERE mr.patient_id = $1 
          ORDER BY mr.created_at DESC
        `
        params = [req.user.id]
      } else if (req.user.role === "doctor") {
        query = `
          SELECT mr.*, u.full_name AS patient_name, c.name AS clinic_name,
                 a.id AS appointment_id, a.type AS appointment_type
          FROM medical_records mr 
          JOIN users u ON mr.patient_id = u.id
          LEFT JOIN clinics c ON mr.clinic_id = c.id
          LEFT JOIN appointments a ON mr.appointment_id = a.id
          WHERE mr.doctor_id = $1 
          ORDER BY mr.created_at DESC
        `
        params = [req.user.id]
      } else if (req.user.role === "clinic_admin") {
        query = `
          SELECT mr.*, 
                 up.full_name AS patient_name, 
                 ud.full_name AS doctor_name, 
                 c.name AS clinic_name,
                 a.id AS appointment_id, 
                 a.type AS appointment_type
          FROM medical_records mr 
          JOIN users up ON mr.patient_id = up.id
          JOIN users ud ON mr.doctor_id = ud.id
          LEFT JOIN clinics c ON mr.clinic_id = c.id
          LEFT JOIN appointments a ON mr.appointment_id = a.id
          ORDER BY mr.created_at DESC
        `
        params = []
      } else {
        return res.status(403).json({ error: "Unauthorized role for accessing medical records" })
      }

      const result = await pool.query(query, params)
      res.json(result.rows)
    } catch (err) {
      logger.error(`Get records error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  static async getPatientRecords(req, res) {
    const { patientId } = req.params

    try {
      // Verify authorization
      if (req.user.role !== "doctor" && req.user.role !== "clinic_admin" && req.user.id !== Number(patientId)) {
        return res.status(403).json({ error: "Not authorized to access these records" })
      }

      // If doctor, verify doctor-patient relationship
      if (req.user.role === "doctor") {
        // Check for direct appointment relationship
        const appointmentCheck = await pool.query(
          "SELECT 1 FROM appointments WHERE doctor_id = $1 AND patient_id = $2 LIMIT 1",
          [req.user.id, patientId]
        );
        
        // Check for clinic relationship
        const clinicCheck = await pool.query(
          `SELECT 1 
           FROM doctor_clinics dc 
           JOIN patient_clinics pc ON dc.clinic_id = pc.clinic_id 
           WHERE dc.doctor_id = $1 AND pc.patient_id = $2 
           LIMIT 1`,
          [req.user.id, patientId]
        );
        
        // If neither relationship exists, deny access
        if (appointmentCheck.rows.length === 0 && clinicCheck.rows.length === 0) {
          return res.status(403).json({ 
            error: "Not authorized to access records for this patient",
            message: "You must have an appointment with this patient or share a clinic to access their records"
          });
        }
      }

      const query = `
        SELECT mr.*, u.full_name AS doctor_name, c.name AS clinic_name,
               a.id AS appointment_id, a.type AS appointment_type
        FROM medical_records mr 
        JOIN users u ON mr.doctor_id = u.id
        LEFT JOIN clinics c ON mr.clinic_id = c.id
        LEFT JOIN appointments a ON mr.appointment_id = a.id
        WHERE mr.patient_id = $1 
        ORDER BY mr.created_at DESC
      `

      const result = await pool.query(query, [patientId])
      res.json(result.rows)
    } catch (err) {
      logger.error(`Get patient records error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  static async update(req, res) {
    const { id } = req.params
    const { diagnosis, treatment, notes } = req.body

    try {
      // Input validation
      if (!id) {
        return res.status(400).json({ error: "Record ID is required" })
      }

      console.log("Updating medical record:", id, "by doctor:", req.user.id)

      await pool.query("BEGIN")

      // Check if record exists and belongs to the doctor
      const recordCheck = await pool.query(
        "SELECT * FROM medical_records WHERE id = $1 AND (doctor_id = $2 OR $3 = 'clinic_admin')",
        [id, req.user.id, req.user.role],
      )

      if (recordCheck.rows.length === 0) {
        await pool.query("ROLLBACK")
        return res.status(404).json({ error: "Record not found or unauthorized" })
      }

      const result = await pool.query(
        `UPDATE medical_records 
         SET diagnosis = COALESCE($1, diagnosis), 
             treatment = COALESCE($2, treatment), 
             notes = COALESCE($3, notes),
             updated_at = NOW() 
         WHERE id = $4 
         RETURNING *`,
        [diagnosis, treatment, notes, id],
      )

      await pool.query("COMMIT")
      logger.info(`Medical record ${id} updated`)
      res.json({ message: "Record updated", record: result.rows[0] })
    } catch (err) {
      await pool.query("ROLLBACK")
      logger.error(`Update record error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }

  static async delete(req, res) {
    const { id } = req.params

    try {
      if (!id) {
        return res.status(400).json({ error: "Record ID is required" })
      }

      await pool.query("BEGIN")

      // Check if record exists and user has permission to delete
      const recordCheck = await pool.query(
        "SELECT * FROM medical_records WHERE id = $1 AND (doctor_id = $2 OR $3 = 'clinic_admin')",
        [id, req.user.id, req.user.role],
      )

      if (recordCheck.rows.length === 0) {
        await pool.query("ROLLBACK")
        return res.status(404).json({ error: "Record not found or unauthorized" })
      }

      await pool.query("DELETE FROM medical_records WHERE id = $1", [id])

      await pool.query("COMMIT")
      logger.info(`Medical record ${id} deleted`)
      res.json({ message: "Record deleted successfully" })
    } catch (err) {
      await pool.query("ROLLBACK")
      logger.error(`Delete record error: ${err.message}`)
      res.status(500).json({ error: "Server error", details: err.message })
    }
  }
}

module.exports = RecordController
