const express = require("express")
const router = express.Router()
const { protect, role } = require("../middleware/auth")
const { executeQuery } = require("../utils/dbUtils")
const logger = require("../middleware/logger")
const { body, param, query } = require("express-validator")
const { validate } = require("../middleware/validator")

// Get all medications with search and filtering
router.get("/", protect, async (req, res) => {
  try {
    const { search, status, category, drug_class, limit = 50, offset = 0 } = req.query

    let query = `
      SELECT id, name, generic_name, brand_names, drug_class, category, 
             strength_options, form_types, prescription_required, status,
             created_at, updated_at
      FROM medications 
      WHERE 1=1
    `
    const params = []
    let paramCount = 1

    if (search) {
      query += ` AND (
        LOWER(name) LIKE LOWER($${paramCount}) OR 
        LOWER(generic_name) LIKE LOWER($${paramCount}) OR
        LOWER(drug_class) LIKE LOWER($${paramCount}) OR
        LOWER(category) LIKE LOWER($${paramCount})
      )`
      params.push(`%${search}%`)
      paramCount++
    }

    if (status && status !== "all") {
      query += ` AND status = $${paramCount}`
      params.push(status)
      paramCount++
    }

    if (category) {
      query += ` AND LOWER(category) = LOWER($${paramCount})`
      params.push(category)
      paramCount++
    }

    if (drug_class) {
      query += ` AND LOWER(drug_class) = LOWER($${paramCount})`
      params.push(drug_class)
      paramCount++
    }

    query += ` ORDER BY name ASC LIMIT $${paramCount} OFFSET $${paramCount + 1}`
    params.push(Number.parseInt(limit), Number.parseInt(offset))

    const result = await executeQuery(query, params)

    // Get total count
    let countQuery = `SELECT COUNT(*) as total FROM medications WHERE 1=1`
    const countParams = []
    let countParamCount = 1

    if (search) {
      countQuery += ` AND (
        LOWER(name) LIKE LOWER($${countParamCount}) OR 
        LOWER(generic_name) LIKE LOWER($${countParamCount}) OR
        LOWER(drug_class) LIKE LOWER($${countParamCount}) OR
        LOWER(category) LIKE LOWER($${countParamCount})
      )`
      countParams.push(`%${search}%`)
      countParamCount++
    }

    if (status && status !== "all") {
      countQuery += ` AND status = $${countParamCount}`
      countParams.push(status)
      countParamCount++
    }

    if (category) {
      countQuery += ` AND LOWER(category) = LOWER($${countParamCount})`
      countParams.push(category)
      countParamCount++
    }

    if (drug_class) {
      countQuery += ` AND LOWER(drug_class) = LOWER($${countParamCount})`
      countParams.push(drug_class)
      countParamCount++
    }

    const countResult = await executeQuery(countQuery, countParams)
    const total = Number.parseInt(countResult.rows[0].total)

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        total,
        limit: Number.parseInt(limit),
        offset: Number.parseInt(offset),
        page: Math.floor(Number.parseInt(offset) / Number.parseInt(limit)) + 1,
        totalPages: Math.ceil(total / Number.parseInt(limit)),
      },
    })
  } catch (error) {
    logger.error(`Get medications error: ${error.message}`)
    res.status(500).json({ success: false, error: "Server error", details: error.message })
  }
})

// Search medications (for prescription lookup)
router.get("/search", protect, async (req, res) => {
  try {
    const { q, limit = 10 } = req.query

    if (!q || q.length < 2) {
      return res.json({ success: true, data: [] })
    }

    const query = `
      SELECT id, name, generic_name, drug_class, category, 
             strength_options, form_types, prescription_required
      FROM medications 
      WHERE status = 'active' AND (
        LOWER(name) LIKE LOWER($1) OR 
        LOWER(generic_name) LIKE LOWER($1)
      )
      ORDER BY name ASC 
      LIMIT $2
    `

    const result = await executeQuery(query, [`%${q}%`, Number.parseInt(limit)])

    res.json({
      success: true,
      data: result.rows,
    })
  } catch (error) {
    logger.error(`Search medications error: ${error.message}`)
    res.status(500).json({ success: false, error: "Server error", details: error.message })
  }
})

// Get medication by ID
router.get("/:id", protect, async (req, res) => {
  try {
    const { id } = req.params

    const query = `
      SELECT * FROM medications WHERE id = $1
    `

    const result = await executeQuery(query, [id])

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "Medication not found" })
    }

    res.json({
      success: true,
      data: result.rows[0],
    })
  } catch (error) {
    logger.error(`Get medication by ID error: ${error.message}`)
    res.status(500).json({ success: false, error: "Server error", details: error.message })
  }
})

// Create medication (platform admin only)
router.post(
  "/",
  protect,
  role(["platform_admin"]),
  [
    body("name").notEmpty().withMessage("Medication name is required"),
    body("drug_class").notEmpty().withMessage("Drug class is required"),
    body("category").notEmpty().withMessage("Category is required"),
  ],
  validate,
  async (req, res) => {
    try {
      const {
        name,
        generic_name,
        brand_names,
        drug_class,
        category,
        active_ingredient,
        strength_options,
        form_types,
        route_of_administration,
        standard_dosage,
        max_daily_dose,
        duration_guidelines,
        contraindications,
        side_effects,
        drug_interactions,
        pregnancy_category,
        controlled_substance_schedule,
        ndc_number,
        rxcui,
        fda_approved,
        prescription_required,
        notes,
        average_cost,
        insurance_tier,
      } = req.body

      const query = `
        INSERT INTO medications (
          name, generic_name, brand_names, drug_class, category, active_ingredient,
          strength_options, form_types, route_of_administration, standard_dosage,
          max_daily_dose, duration_guidelines, contraindications, side_effects,
          drug_interactions, pregnancy_category, controlled_substance_schedule,
          ndc_number, rxcui, fda_approved, prescription_required, added_by_admin_id,
          notes, average_cost, insurance_tier, status
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
          $18, $19, $20, $21, $22, $23, $24, $25, 'active'
        ) RETURNING *
      `

      const values = [
        name,
        generic_name,
        brand_names ? JSON.stringify(brand_names) : null,
        drug_class,
        category,
        active_ingredient,
        strength_options ? JSON.stringify(strength_options) : null,
        form_types ? JSON.stringify(form_types) : null,
        route_of_administration ? JSON.stringify(route_of_administration) : null,
        standard_dosage ? JSON.stringify(standard_dosage) : null,
        max_daily_dose,
        duration_guidelines,
        contraindications,
        side_effects ? JSON.stringify(side_effects) : null,
        drug_interactions ? JSON.stringify(drug_interactions) : null,
        pregnancy_category,
        controlled_substance_schedule,
        ndc_number,
        rxcui,
        fda_approved !== undefined ? fda_approved : true,
        prescription_required !== undefined ? prescription_required : true,
        req.user.id,
        notes,
        average_cost,
        insurance_tier,
      ]

      const result = await executeQuery(query, values)

      logger.info(`Medication created: ${result.rows[0].id} by admin: ${req.user.id}`)

      res.status(201).json({
        success: true,
        data: result.rows[0],
        message: "Medication created successfully",
      })
    } catch (error) {
      logger.error(`Create medication error: ${error.message}`)
      res.status(500).json({ success: false, error: "Server error", details: error.message })
    }
  },
)

// Update medication (platform admin only)
router.put(
  "/:id",
  protect,
  role(["platform_admin"]),
  [
    param("id").isInt().withMessage("Invalid medication ID"),
    body("name").optional().notEmpty().withMessage("Medication name cannot be empty"),
    body("drug_class").optional().notEmpty().withMessage("Drug class cannot be empty"),
    body("category").optional().notEmpty().withMessage("Category cannot be empty"),
  ],
  validate,
  async (req, res) => {
    try {
      const { id } = req.params
      const updateData = req.body

      // Check if medication exists
      const existingMed = await executeQuery("SELECT id FROM medications WHERE id = $1", [id])
      if (existingMed.rows.length === 0) {
        return res.status(404).json({ success: false, error: "Medication not found" })
      }

      // Build dynamic update query
      const updateFields = []
      const values = []
      let paramCount = 1

      const allowedFields = [
        "name",
        "generic_name",
        "brand_names",
        "drug_class",
        "category",
        "active_ingredient",
        "strength_options",
        "form_types",
        "route_of_administration",
        "standard_dosage",
        "max_daily_dose",
        "duration_guidelines",
        "contraindications",
        "side_effects",
        "drug_interactions",
        "pregnancy_category",
        "controlled_substance_schedule",
        "ndc_number",
        "rxcui",
        "fda_approved",
        "prescription_required",
        "notes",
        "average_cost",
        "insurance_tier",
        "status",
      ]

      for (const field of allowedFields) {
        if (updateData[field] !== undefined) {
          updateFields.push(`${field} = $${paramCount}`)

          // Handle JSON fields
          if (
            [
              "brand_names",
              "strength_options",
              "form_types",
              "route_of_administration",
              "standard_dosage",
              "side_effects",
              "drug_interactions",
            ].includes(field)
          ) {
            values.push(updateData[field] ? JSON.stringify(updateData[field]) : null)
          } else {
            values.push(updateData[field])
          }
          paramCount++
        }
      }

      if (updateFields.length === 0) {
        return res.status(400).json({ success: false, error: "No fields to update" })
      }

      updateFields.push(`updated_at = NOW()`)
      values.push(id)

      const query = `
        UPDATE medications 
        SET ${updateFields.join(", ")}
        WHERE id = $${paramCount}
        RETURNING *
      `

      const result = await executeQuery(query, values)

      logger.info(`Medication updated: ${id} by admin: ${req.user.id}`)

      res.json({
        success: true,
        data: result.rows[0],
        message: "Medication updated successfully",
      })
    } catch (error) {
      logger.error(`Update medication error: ${error.message}`)
      res.status(500).json({ success: false, error: "Server error", details: error.message })
    }
  },
)

// Delete medication (platform admin only)
router.delete(
  "/:id",
  protect,
  role(["platform_admin"]),
  [param("id").isInt().withMessage("Invalid medication ID")],
  validate,
  async (req, res) => {
    try {
      const { id } = req.params

      // Check if medication exists
      const existingMed = await executeQuery("SELECT id, name FROM medications WHERE id = $1", [id])
      if (existingMed.rows.length === 0) {
        return res.status(404).json({ success: false, error: "Medication not found" })
      }

      // Check if medication is used in any prescriptions
      const prescriptionCheck = await executeQuery(
        "SELECT COUNT(*) as count FROM prescriptions WHERE medication::text LIKE $1",
        [`%"medication_id":${id}%`],
      )

      if (Number.parseInt(prescriptionCheck.rows[0].count) > 0) {
        // Don't delete, just deactivate
        await executeQuery("UPDATE medications SET status = 'discontinued', updated_at = NOW() WHERE id = $1", [id])

        logger.info(`Medication discontinued: ${id} by admin: ${req.user.id}`)

        return res.json({
          success: true,
          message: "Medication discontinued (used in prescriptions)",
        })
      }

      // Safe to delete
      await executeQuery("DELETE FROM medications WHERE id = $1", [id])

      logger.info(`Medication deleted: ${id} by admin: ${req.user.id}`)

      res.json({
        success: true,
        message: "Medication deleted successfully",
      })
    } catch (error) {
      logger.error(`Delete medication error: ${error.message}`)
      res.status(500).json({ success: false, error: "Server error", details: error.message })
    }
  },
)

module.exports = router
