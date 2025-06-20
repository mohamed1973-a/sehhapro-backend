const db = require("../db")

const dashboardController = {
  getClinicAdminStats: async (req, res) => {
    const clinicId = req.params.clinicId

    try {
      // Clinic Count
      const clinicCountQuery = `SELECT COUNT(*) as clinic_count FROM clinics WHERE id = $1`
      const clinicCountResult = await db.query(clinicCountQuery, [clinicId])
      const clinicCount = clinicCountResult.rows[0].clinic_count

      // Doctor Count
      const doctorCountQuery = `SELECT COUNT(*) as doctor_count FROM doctors WHERE clinic_id = $1`
      const doctorCountResult = await db.query(doctorCountQuery, [clinicId])
      const doctorCount = doctorCountResult.rows[0].doctor_count

      // Patient Count
      const patientCountQuery = `SELECT COUNT(*) as patient_count FROM patients WHERE clinic_id = $1`
      const patientCountResult = await db.query(patientCountQuery, [clinicId])
      const patientCount = patientCountResult.rows[0].patient_count

      // Fix the admin count query
      const adminCountQuery = `
        SELECT COUNT(DISTINCT ac.admin_id) as admin_count
        FROM admin_clinics ac
        JOIN users u ON ac.admin_id = u.id
        WHERE ac.clinic_id = $1 AND u.role = 'clinic_admin'
      `
      const adminCountResult = await db.query(adminCountQuery, [clinicId])
      const adminCount = adminCountResult.rows[0].admin_count

      res.json({
        clinic_count: clinicCount,
        doctor_count: doctorCount,
        patient_count: patientCount,
        admin_count: adminCount,
      })
    } catch (err) {
      console.error(err.message)
      res.status(500).json({
        clinic_count: 0,
        doctor_count: 0,
        patient_count: 0,
        admin_count: 0,
      })
    }
  },
}

module.exports = dashboardController
