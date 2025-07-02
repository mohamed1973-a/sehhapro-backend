const pool = require("../db")
const logger = require("../middleware/logger")
const NotificationController = require("./notificationController")

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

const createLabRequest = async (req, res) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { 
      patient_id, 
      doctor_id, 
      lab_clinic_id, 
      tests, 
      notes, 
      priority 
    } = req.body

    // Insert lab request
    const result = await client.query(
      `INSERT INTO lab_requests 
       (patient_id, doctor_id, lab_clinic_id, tests, notes, status, priority) 
       VALUES ($1, $2, $3, $4, $5, $6, $7) 
       RETURNING *`,
      [
        patient_id, 
        doctor_id, 
        lab_clinic_id, 
        JSON.stringify(tests), 
        notes, 
        'pending', 
        priority || 'normal'
      ]
    )

    const labRequest = result.rows[0]

    // Notification for patient about new lab request
    await NotificationController.createNotification({
      userId: patient_id,
      message: `New lab request created by Dr. ${req.user.full_name}`,
      type: "lab_result",
      priority: "normal",
      refId: labRequest.id
    })

    // Notification for lab technician about new request
    const labTechResult = await client.query(
      `SELECT user_id FROM lab_staff WHERE lab_clinic_id = $1`,
      [lab_clinic_id]
    )

    for (const labTech of labTechResult.rows) {
      await NotificationController.createNotification({
        userId: labTech.user_id,
        message: `New lab request for patient ${patient_id}`,
        type: "lab_result",
        priority: "high",
        refId: labRequest.id
      })
    }

    await client.query('COMMIT')

    res.status(201).json({
      success: true,
      data: labRequest,
      notifications: "Created for patient and lab techs"
    })
  } catch (error) {
    await client.query('ROLLBACK')
    logger.error(`Create lab request error: ${error.message}`)
    res.status(500).json({ 
      success: false, 
      error: "Server error", 
      details: error.message 
    })
  } finally {
    client.release()
  }
}

const updateLabRequestStatus = async (req, res) => {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { id } = req.params
    const { status, results, notes } = req.body

    const result = await client.query(
      `UPDATE lab_requests 
       SET status = $1, results = $2, notes = $3, updated_at = NOW() 
       WHERE id = $4 
       RETURNING *`,
      [status, JSON.stringify(results), notes, id]
    )

    const updatedLabRequest = result.rows[0]

    // Notification for patient about lab request status update
    await NotificationController.createNotification({
      userId: updatedLabRequest.patient_id,
      message: `Lab request status updated to ${status}`,
      type: "lab_result",
      priority: status === 'completed' ? "high" : "normal",
      refId: updatedLabRequest.id
    })

    // Notification for doctor about lab request status
    await NotificationController.createNotification({
      userId: updatedLabRequest.doctor_id,
      message: `Lab request for patient updated to ${status}`,
      type: "lab_result",
      priority: "normal",
      refId: updatedLabRequest.id
    })

    await client.query('COMMIT')

    res.status(200).json({
      success: true,
      data: updatedLabRequest,
      notifications: "Created for patient and doctor"
    })
  } catch (error) {
    await client.query('ROLLBACK')
    logger.error(`Update lab request status error: ${error.message}`)
    res.status(500).json({ 
      success: false, 
      error: "Server error", 
      details: error.message 
    })
  } finally {
    client.release()
  }
}

module.exports = { 
  getLabResults, 
  createLabRequest, 
  updateLabRequestStatus 
}
