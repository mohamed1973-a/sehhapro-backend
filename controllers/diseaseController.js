const { executeQuery } = require("../utils/dbUtils")
const logger = require("../middleware/logger")
const asyncHandler = require("../utils/asyncHandler")

class DiseaseController {
  /**
   * Get all diseases or search by name/code
   */
  static async getAll(req, res) {
    try {
      const { q, limit = 20 } = req.query
      let query, params

      if (q) {
        // Search by name, code, or description
        query = `
          SELECT id, name, icd_code, description, category, severity, symptoms, common_treatments
          FROM diseases
          WHERE LOWER(name) LIKE LOWER($1)
             OR LOWER(icd_code) LIKE LOWER($1)
             OR LOWER(description) LIKE LOWER($1)
             OR LOWER(category) LIKE LOWER($1)
          ORDER BY name
          LIMIT $2
        `
        params = [`%${q}%`, limit]
      } else {
        // Get all diseases with limit
        query = `
          SELECT id, name, icd_code, description, category, severity, symptoms, common_treatments
          FROM diseases
          ORDER BY name
          LIMIT $1
        `
        params = [limit]
      }

      const result = await executeQuery(query, params)

      // If no results and database might be empty, return fallback data
      if (result.rows.length === 0) {
        return res.status(200).json({
          success: true,
          data: getFallbackDiseases(q),
          message: "Using fallback disease data",
        })
      }

      res.status(200).json({
        success: true,
        data: result.rows,
      })
    } catch (err) {
      logger.error(`Get diseases error: ${err.message}`)

      // Return fallback data on error
      res.status(200).json({
        success: true,
        data: getFallbackDiseases(req.query.q),
        message: "Using fallback disease data due to database error",
      })
    }
  }

  /**
   * Get disease by ID
   */
  static async getById(req, res) {
    try {
      const { id } = req.params

      const query = `
        SELECT id, name, icd_code, description, category, severity, symptoms, common_treatments
        FROM diseases
        WHERE id = $1
      `
      const result = await executeQuery(query, [id])

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Disease not found",
        })
      }

      res.status(200).json({
        success: true,
        data: result.rows[0],
      })
    } catch (err) {
      logger.error(`Get disease by ID error: ${err.message}`)
      res.status(500).json({
        success: false,
        error: "Server error",
        details: err.message,
      })
    }
  }

  /**
   * Get medications for a disease
   */
  static async getMedications(req, res) {
    try {
      const { id } = req.params

      // First check if disease exists
      const diseaseQuery = `SELECT id, name, category FROM diseases WHERE id = $1`
      const diseaseResult = await executeQuery(diseaseQuery, [id])

      if (diseaseResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Disease not found",
        })
      }

      const disease = diseaseResult.rows[0]

      // Get medications for this disease
      const query = `
        SELECT m.id, m.name, m.generic_name, m.drug_class, m.category, 
               m.strength_options, m.form_types, m.prescription_required,
               dm.default_dose, dm.default_frequency, dm.default_duration, dm.notes_for_disease
        FROM medications m
        JOIN disease_medications dm ON m.id = dm.medication_id
        WHERE dm.disease_id = $1 AND m.status = 'active'
        ORDER BY m.name ASC
      `
      const result = await executeQuery(query, [id])

      // If no specific medications found, get medications by category
      if (result.rows.length === 0 && disease.category) {
        const categoryQuery = `
          SELECT id, name, generic_name, drug_class, category, 
                 strength_options, form_types, prescription_required
          FROM medications
          WHERE category = $1 AND status = 'active'
          ORDER BY name ASC
          LIMIT 10
        `
        const categoryResult = await executeQuery(categoryQuery, [disease.category])

        return res.status(200).json({
          success: true,
          data: categoryResult.rows,
          message: "No specific medications found for this disease. Showing medications for the disease category.",
        })
      }

      res.status(200).json({
        success: true,
        data: result.rows,
      })
    } catch (err) {
      logger.error(`Get disease medications error: ${err.message}`)
      res.status(500).json({
        success: false,
        error: "Server error",
        details: err.message,
      })
    }
  }
}

// Helper function for fallback disease data
function getFallbackDiseases(searchTerm) {
  const allDiseases = [
    {
      id: 1,
      name: "Hypertension",
      icd_code: "I10",
      description: "High blood pressure",
      category: "Cardiovascular",
      severity: "moderate",
    },
    {
      id: 2,
      name: "Type 2 Diabetes Mellitus",
      icd_code: "E11",
      description: "Non-insulin-dependent diabetes mellitus",
      category: "Endocrine",
      severity: "moderate",
    },
    {
      id: 3,
      name: "Acute Upper Respiratory Infection",
      icd_code: "J06.9",
      description: "Common cold or flu-like symptoms",
      category: "Respiratory",
      severity: "mild",
    },
    {
      id: 4,
      name: "Gastroesophageal Reflux Disease",
      icd_code: "K21.9",
      description: "GERD - acid reflux condition",
      category: "Digestive",
      severity: "mild",
    },
    {
      id: 5,
      name: "Migraine",
      icd_code: "G43.9",
      description: "Recurrent headache disorder",
      category: "Neurological",
      severity: "moderate",
    },
    {
      id: 6,
      name: "Asthma",
      icd_code: "J45.9",
      description: "Chronic respiratory condition",
      category: "Respiratory",
      severity: "moderate",
    },
    {
      id: 7,
      name: "Depression",
      icd_code: "F32.9",
      description: "Major depressive disorder",
      category: "Mental Health",
      severity: "moderate",
    },
    {
      id: 8,
      name: "Osteoarthritis",
      icd_code: "M19.9",
      description: "Degenerative joint disease",
      category: "Musculoskeletal",
      severity: "moderate",
    },
    {
      id: 9,
      name: "Coronary Artery Disease",
      icd_code: "I25.1",
      description: "Atherosclerotic heart disease",
      category: "Cardiovascular",
      severity: "severe",
    },
    {
      id: 10,
      name: "Chronic Obstructive Pulmonary Disease",
      icd_code: "J44.9",
      description: "COPD - progressive lung disease",
      category: "Respiratory",
      severity: "severe",
    },
  ]

  if (!searchTerm) return allDiseases

  return allDiseases.filter(
    (disease) =>
      disease.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      disease.icd_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      disease.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      disease.category.toLowerCase().includes(searchTerm.toLowerCase()),
  )
}

module.exports = DiseaseController
