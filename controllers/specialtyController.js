const { executeQuery } = require("../utils/dbUtils")
const logger = require("../middleware/logger")
const asyncHandler = require("../utils/asyncHandler")

// Master list of all medical specialties
const ALL_MEDICAL_SPECIALTIES = [
  "General Medicine",
  "Family Medicine",
  "Internal Medicine",
  "Pediatrics",
  "Cardiology",
  "Dermatology",
  "Endocrinology",
  "Gastroenterology",
  "Geriatrics",
  "Gynecology",
  "Hematology",
  "Infectious Disease",
  "Nephrology",
  "Neurology",
  "Obstetrics",
  "Oncology",
  "Ophthalmology",
  "Orthopedics",
  "Otolaryngology",
  "Psychiatry",
  "Pulmonology",
  "Radiology",
  "Rheumatology",
  "Surgery",
  "Urology",
  "Emergency Medicine",
  "Anesthesiology",
  "Pathology",
  "Physical Medicine",
  "Preventive Medicine",
  "Allergy and Immunology",
  "Nuclear Medicine",
  "Pain Management",
  "Sports Medicine",
  "Vascular Surgery",
  "Plastic Surgery",
  "Thoracic Surgery",
  "Colorectal Surgery",
  "Neonatal Medicine",
  "Adolescent Medicine",
  "Sleep Medicine",
  "Palliative Care",
  "Rehabilitation Medicine",
  "Occupational Medicine",
  "Forensic Medicine",
]

class SpecialtyController {
  /**
   * Get all specialties with doctor counts
   * Can filter by clinic_id and appointment_type (in-person/telemedicine)
   */
  static async getAll(req, res) {
    try {
      const { clinic_id, appointment_type } = req.query
      console.log(`Getting specialties - clinic_id: ${clinic_id}, appointment_type: ${appointment_type}`)

      // Get all specialties from the database first
      const specialtiesQuery = `
        SELECT DISTINCT specialty 
        FROM doctor_portfolios 
        WHERE specialty IS NOT NULL AND specialty != ''
        ORDER BY specialty
      `
      const specialtiesResult = await executeQuery(specialtiesQuery)
      const dbSpecialties = specialtiesResult.rows.map((row) => row.specialty)

      // Create a Set to ensure uniqueness (case-insensitive)
      const specialtySet = new Set()

      // Add all specialties to the set (normalized to lowercase for comparison)
      const normalizedSpecialties = {}

      // First add master list
      ALL_MEDICAL_SPECIALTIES.forEach((specialty) => {
        const normalizedName = specialty.toLowerCase()
        specialtySet.add(normalizedName)
        normalizedSpecialties[normalizedName] = specialty // Keep original casing
      })

      // Then add DB specialties, avoiding duplicates
      dbSpecialties.forEach((specialty) => {
        const normalizedName = specialty.toLowerCase()
        specialtySet.add(normalizedName)
        // Only override if not already in our mapping (prefer master list casing)
        if (!normalizedSpecialties[normalizedName]) {
          normalizedSpecialties[normalizedName] = specialty
        }
      })

      // Convert set back to array with proper casing
      const allSpecialties = Array.from(specialtySet)
        .map((normalizedName) => normalizedSpecialties[normalizedName])
        .sort()

      console.log(`Found ${allSpecialties.length} unique specialties (${dbSpecialties.length} from database)`)

      // For each specialty, count doctors based on filters
      const result = []

      for (const specialty of allSpecialties) {
        let doctorCountQuery = `
          SELECT COUNT(DISTINCT dp.doctor_id) as doctor_count
          FROM doctor_portfolios dp
          JOIN users u ON dp.doctor_id = u.id
        `

        const queryParams = [specialty]
        let paramIndex = 1

        // Base condition: match specialty (case insensitive)
        const conditions = [`LOWER(dp.specialty) = LOWER($${paramIndex})`]

        // Add telemedicine filter if needed
        if (appointment_type === "telemedicine") {
          paramIndex++
          conditions.push(`dp.available_for_telemedicine = $${paramIndex}`)
          queryParams.push(true)
        }

        // Add clinic filter if needed for in-person appointments
        if (clinic_id && appointment_type !== "telemedicine") {
          paramIndex++
          conditions.push(`
            EXISTS (
              SELECT 1 FROM doctor_clinics dc 
              WHERE dc.doctor_id = dp.doctor_id 
              AND dc.clinic_id = $${paramIndex}
            )
          `)
          queryParams.push(clinic_id)
        }

        // Complete the query
        doctorCountQuery += ` WHERE ${conditions.join(" AND ")}`

        // Execute count query
        const countResult = await executeQuery(doctorCountQuery, queryParams)
        const doctorCount = Number.parseInt(countResult.rows[0]?.doctor_count || 0)

        // Add to results
        result.push({
          id: allSpecialties.indexOf(specialty) + 1,
          name: specialty,
          description: `Specialized medical care in ${specialty}`,
          available_doctors: doctorCount,
        })
      }

      console.log(`Returning ${result.length} specialties with doctor counts`)
      res.status(200).json({ success: true, data: result })
    } catch (err) {
      logger.error(`Get specialties error: ${err.message}`)

      // On error, return all specialties with 0 counts
      const fallbackSpecialties = ALL_MEDICAL_SPECIALTIES.map((specialty, index) => ({
        id: index + 1,
        name: specialty,
        description: `Specialized medical care in ${specialty}`,
        available_doctors: 0,
      }))

      res.status(200).json({
        success: true,
        data: fallbackSpecialties,
        message: "Using fallback specialties due to database error",
      })
    }
  }
}

module.exports = SpecialtyController
