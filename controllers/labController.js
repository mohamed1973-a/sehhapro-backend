const pool = require("../db")

const getLabResults = async (req, res) => {
  try {
    const patientId = req.params.patientId

    const result = await pool.query(
      `SELECT lr.*, u.full_name as patient_name, d.full_name as doctor_name, c.name as clinic_name
       FROM lab_requests lr
       JOIN users u ON lr.patient_id = u.id
       JOIN users d ON lr.doctor_id = d.id  
       JOIN clinics c ON lr.lab_clinic_id = c.id
       WHERE lr.patient_id = $1 AND lr.status = 'completed'
       ORDER BY lr.updated_at DESC`,
      [patientId],
    )

    res.json(result.rows)
  } catch (err) {
    console.error(err.message)
    res.status(500).send("Server Error")
  }
}

module.exports = { getLabResults }
