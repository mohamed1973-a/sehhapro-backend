/**
 * Staff Salary Controller
 *
 * Manages clinic staff salaries, payments, and adjustments.
 * Handles both staff with accounts (doctors, nurses) and without accounts (agents, cleaners).
 */

const { pool } = require("../config/database")
const logger = require("../middleware/logger")
const asyncHandler = require("../utils/asyncHandler")

class StaffSalaryController {
  /**
   * Get all clinic staff (both users and non-users)
   */
  static async getClinicStaff(req, res) {
    try {
      const { clinicId } = req.params
      const { page = 1, limit = 10, search, position, status } = req.query

      console.log(`[StaffSalaryController] Getting staff for clinic ${clinicId}`)

      // Validate clinicId is a valid integer
      const clinicIdInt = parseInt(clinicId, 10)
      if (isNaN(clinicIdInt)) {
        return res.status(400).json({
          success: false,
          error: "Invalid clinic ID format"
        })
      }

      // Verify clinic access
      if (req.user.role === "clinic_admin") {
        const clinicAccess = await pool.query(
          "SELECT 1 FROM admin_clinics WHERE admin_id = $1 AND clinic_id = $2",
          [req.user.id, clinicIdInt]
        )
        if (clinicAccess.rows.length === 0) {
          return res.status(403).json({
            success: false,
            error: "Access denied to this clinic"
          })
        }
      }

      // Build query for clinic staff (non-users)
      let staffQuery = `
        SELECT 
          cs.id,
          cs.full_name,
          cs.phone,
          cs.email,
          cs.position,
          cs.employment_type,
          cs.monthly_salary,
          cs.status,
          cs.start_date,
          cs.end_date,
          cs.notes,
          cs.created_at,
          'clinic_staff' as staff_type,
          NULL as user_id,
          NULL as balance
        FROM clinic_staff cs
        WHERE cs.clinic_id = $1
      `
      const staffParams = [clinicIdInt]
      let paramCount = 1

      if (search) {
        staffQuery += ` AND (cs.full_name ILIKE $${++paramCount} OR cs.email ILIKE $${++paramCount})`
        staffParams.push(`%${search}%`, `%${search}%`)
      }

      if (position) {
        staffQuery += ` AND cs.position = $${++paramCount}`
        staffParams.push(position)
      }

      if (status) {
        staffQuery += ` AND cs.status = $${++paramCount}`
        staffParams.push(status)
      }

      // Build query for user staff (doctors, nurses)
      let userStaffQuery = `
        SELECT 
          u.id as user_id,
          u.full_name,
          u.phone,
          u.email,
          r.name as position,
          u.employment_type,
          COALESCE(u.base_salary, 
            CASE 
              WHEN r.name = 'doctor' THEN 50000
              WHEN r.name = 'nurse' THEN 35000
              WHEN r.name = 'lab_tech' THEN 40000
              ELSE 0
            END
          ) as monthly_salary,
          u.status,
          u.start_date,
          NULL as end_date,
          NULL as notes,
          u.created_at,
          'user_staff' as staff_type,
          u.id as user_id,
          COALESCE(u.balance, 0) as balance
        FROM users u
        JOIN roles r ON u.role_id = r.id
        WHERE (u.id IN (SELECT doctor_id FROM doctor_clinics WHERE clinic_id = $1)
               OR u.id IN (SELECT nurse_id FROM nurse_clinics WHERE clinic_id = $1)
               OR u.id IN (SELECT lab_id FROM lab_clinics WHERE clinic_id = $1))
          AND r.name IN ('doctor', 'nurse', 'lab_tech')
      `
      const userStaffParams = [clinicIdInt]
      let userParamCount = 1

      if (search) {
        userStaffQuery += ` AND (u.full_name ILIKE $${++userParamCount} OR u.email ILIKE $${++userParamCount})`
        userStaffParams.push(`%${search}%`, `%${search}%`)
      }

      if (position) {
        userStaffQuery += ` AND r.name = $${++userParamCount}`
        userStaffParams.push(position)
      }

      if (status) {
        userStaffQuery += ` AND u.status = $${++userParamCount}`
        userStaffParams.push(status)
      }

      // Get clinic staff count
      const staffCountQuery = `SELECT COUNT(*) FROM (${staffQuery}) as staff_count`
      const staffCountResult = await pool.query(staffCountQuery, staffParams)
      const staffCount = parseInt(staffCountResult.rows[0].count)

      // Get user staff count
      const userStaffCountQuery = `SELECT COUNT(*) FROM (${userStaffQuery}) as user_staff_count`
      const userStaffCountResult = await pool.query(userStaffCountQuery, userStaffParams)
      const userStaffCount = parseInt(userStaffCountResult.rows[0].count)

      const totalCount = staffCount + userStaffCount

      // Get paginated results
      const offset = (page - 1) * limit
      const remainingLimit = limit

      // Get clinic staff with pagination
      const paginatedStaffQuery = `
        ${staffQuery}
        ORDER BY full_name
        LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
      `
      const paginatedStaffParams = [...staffParams, remainingLimit, offset]
      const staffResult = await pool.query(paginatedStaffQuery, paginatedStaffParams)

      // Calculate remaining limit for user staff
      const staffResultCount = staffResult.rows.length
      const userStaffLimit = Math.max(0, remainingLimit - staffResultCount)
      const userStaffOffset = Math.max(0, offset - staffCount)

      // Get user staff with pagination
      const paginatedUserStaffQuery = `
        ${userStaffQuery}
        ORDER BY full_name
        LIMIT $${userParamCount + 1} OFFSET $${userParamCount + 2}
      `
      const paginatedUserStaffParams = [...userStaffParams, userStaffLimit, userStaffOffset]
      const userStaffResult = await pool.query(paginatedUserStaffQuery, paginatedUserStaffParams)

      // Combine results
      const combinedResults = [...staffResult.rows, ...userStaffResult.rows]
      combinedResults.sort((a, b) => a.full_name.localeCompare(b.full_name))

      console.log(`[StaffSalaryController] Found ${combinedResults.length} staff members`)

      res.json({
        success: true,
        data: combinedResults,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalCount,
          pages: Math.ceil(totalCount / limit)
        },
        message: `Found ${combinedResults.length} staff members`
      })
    } catch (error) {
      console.error("[StaffSalaryController] Get clinic staff error:", error)
      logger.error(`Get clinic staff error: ${error.message}`)
      res.status(500).json({
        success: false,
        error: "Server error",
        details: error.message
      })
    }
  }

  /**
   * Create new clinic staff member (non-user)
   */
  static async createClinicStaff(req, res) {
    try {
      const { clinicId } = req.params
      const {
        full_name,
        phone,
        email,
        position,
        employment_type = "full_time",
        monthly_salary,
        notes
      } = req.body

      console.log(`[StaffSalaryController] Creating staff member for clinic ${clinicId}`)

      // Validate required fields
      if (!full_name || !position || !monthly_salary) {
        return res.status(400).json({
          success: false,
          error: "Full name, position, and monthly salary are required"
        })
      }

      // Verify clinic access
      if (req.user.role === "clinic_admin") {
        const clinicAccess = await pool.query(
          "SELECT 1 FROM admin_clinics WHERE admin_id = $1 AND clinic_id = $2",
          [req.user.id, clinicId]
        )
        if (clinicAccess.rows.length === 0) {
          return res.status(403).json({
            success: false,
            error: "Access denied to this clinic"
          })
        }
      }

      // Create staff member
      const result = await pool.query(
        `INSERT INTO clinic_staff 
         (clinic_id, full_name, phone, email, position, employment_type, monthly_salary, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [clinicId, full_name, phone, email, position, employment_type, monthly_salary, notes]
      )

      const staffMember = result.rows[0]

      logger.info(`Clinic staff created: ${full_name} at clinic ${clinicId}`)

      res.status(201).json({
        success: true,
        data: staffMember,
        message: "Staff member created successfully"
      })
    } catch (error) {
      console.error("[StaffSalaryController] Create clinic staff error:", error)
      logger.error(`Create clinic staff error: ${error.message}`)
      res.status(500).json({
        success: false,
        error: "Server error",
        details: error.message
      })
    }
  }

  /**
   * Update clinic staff member
   */
  static async updateClinicStaff(req, res) {
    try {
      const { clinicId, staffId } = req.params
      const {
        full_name,
        phone,
        email,
        position,
        employment_type,
        monthly_salary,
        status,
        notes
      } = req.body

      console.log(`[StaffSalaryController] Updating staff member ${staffId} for clinic ${clinicId}`)

      // Verify clinic access
      if (req.user.role === "clinic_admin") {
        const clinicAccess = await pool.query(
          "SELECT 1 FROM admin_clinics WHERE admin_id = $1 AND clinic_id = $2",
          [req.user.id, clinicId]
        )
        if (clinicAccess.rows.length === 0) {
          return res.status(403).json({
            success: false,
            error: "Access denied to this clinic"
          })
        }
      }

      // Check if staff member exists and belongs to clinic
      const staffCheck = await pool.query(
        "SELECT 1 FROM clinic_staff WHERE id = $1 AND clinic_id = $2",
        [staffId, clinicId]
      )
      if (staffCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Staff member not found"
        })
      }

      // Build update query dynamically
      const updateFields = []
      const updateValues = []
      let paramCount = 0

      if (full_name !== undefined) {
        updateFields.push(`full_name = $${++paramCount}`)
        updateValues.push(full_name)
      }
      if (phone !== undefined) {
        updateFields.push(`phone = $${++paramCount}`)
        updateValues.push(phone)
      }
      if (email !== undefined) {
        updateFields.push(`email = $${++paramCount}`)
        updateValues.push(email)
      }
      if (position !== undefined) {
        updateFields.push(`position = $${++paramCount}`)
        updateValues.push(position)
      }
      if (employment_type !== undefined) {
        updateFields.push(`employment_type = $${++paramCount}`)
        updateValues.push(employment_type)
      }
      if (monthly_salary !== undefined) {
        updateFields.push(`monthly_salary = $${++paramCount}`)
        updateValues.push(monthly_salary)
      }
      if (status !== undefined) {
        updateFields.push(`status = $${++paramCount}`)
        updateValues.push(status)
      }
      if (notes !== undefined) {
        updateFields.push(`notes = $${++paramCount}`)
        updateValues.push(notes)
      }

      if (updateFields.length === 0) {
        return res.status(400).json({
          success: false,
          error: "No fields to update"
        })
      }

      updateValues.push(staffId, clinicId)
      const result = await pool.query(
        `UPDATE clinic_staff 
         SET ${updateFields.join(", ")}, updated_at = NOW()
         WHERE id = $${++paramCount} AND clinic_id = $${++paramCount}
         RETURNING *`,
        updateValues
      )

      const updatedStaff = result.rows[0]

      logger.info(`Clinic staff updated: ${updatedStaff.full_name} at clinic ${clinicId}`)

      res.json({
        success: true,
        data: updatedStaff,
        message: "Staff member updated successfully"
      })
    } catch (error) {
      console.error("[StaffSalaryController] Update clinic staff error:", error)
      logger.error(`Update clinic staff error: ${error.message}`)
      res.status(500).json({
        success: false,
        error: "Server error",
        details: error.message
      })
    }
  }

  /**
   * Delete clinic staff member
   */
  static async deleteClinicStaff(req, res) {
    try {
      const { clinicId, staffId } = req.params

      console.log(`[StaffSalaryController] Deleting staff member ${staffId} from clinic ${clinicId}`)

      // Verify clinic access
      if (req.user.role === "clinic_admin") {
        const clinicAccess = await pool.query(
          "SELECT 1 FROM admin_clinics WHERE admin_id = $1 AND clinic_id = $2",
          [req.user.id, clinicId]
        )
        if (clinicAccess.rows.length === 0) {
          return res.status(403).json({
            success: false,
            error: "Access denied to this clinic"
          })
        }
      }

      // Check if staff member exists and belongs to clinic
      const staffCheck = await pool.query(
        "SELECT full_name FROM clinic_staff WHERE id = $1 AND clinic_id = $2",
        [staffId, clinicId]
      )
      if (staffCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Staff member not found"
        })
      }

      // Delete staff member
      await pool.query(
        "DELETE FROM clinic_staff WHERE id = $1 AND clinic_id = $2",
        [staffId, clinicId]
      )

      logger.info(`Clinic staff deleted: ${staffCheck.rows[0].full_name} from clinic ${clinicId}`)

      res.json({
        success: true,
        message: "Staff member deleted successfully"
      })
    } catch (error) {
      console.error("[StaffSalaryController] Delete clinic staff error:", error)
      logger.error(`Delete clinic staff error: ${error.message}`)
      res.status(500).json({
        success: false,
        error: "Server error",
        details: error.message
      })
    }
  }

  /**
   * Get salary payments for clinic
   */
  static async getSalaryPayments(req, res) {
    try {
      const { clinicId } = req.params
      const { page = 1, limit = 10, month, status, staffId } = req.query

      console.log(`[StaffSalaryController] Getting salary payments for clinic ${clinicId}`)

      // Validate clinicId is a valid integer
      const clinicIdInt = parseInt(clinicId, 10)
      if (isNaN(clinicIdInt)) {
        return res.status(400).json({
          success: false,
          error: "Invalid clinic ID format"
        })
      }

      // Verify clinic access
      if (req.user.role === "clinic_admin") {
        const clinicAccess = await pool.query(
          "SELECT 1 FROM admin_clinics WHERE admin_id = $1 AND clinic_id = $2",
          [req.user.id, clinicIdInt]
        )
        if (clinicAccess.rows.length === 0) {
          return res.status(403).json({
            success: false,
            error: "Access denied to this clinic"
          })
        }
      }

      // Build base query
      let query = `
        SELECT 
          ssp.*,
          cs.full_name as staff_name,
          cs.position,
          u.full_name as processed_by_name
        FROM staff_salary_payments ssp
        JOIN clinic_staff cs ON ssp.staff_id = cs.id
        LEFT JOIN users u ON ssp.created_by = u.id
        WHERE ssp.clinic_id = $1
      `
      const params = [clinicIdInt]
      let paramCount = 1

      if (month) {
        query += ` AND ssp.payment_month = $${++paramCount}`
        params.push(month)
      }

      if (status) {
        query += ` AND ssp.payment_status = $${++paramCount}`
        params.push(status)
      }

      if (staffId) {
        const staffIdInt = parseInt(staffId, 10)
        if (!isNaN(staffIdInt)) {
        query += ` AND ssp.staff_id = $${++paramCount}`
          params.push(staffIdInt)
        }
      }

      // Get total count first
      const countQuery = `SELECT COUNT(*) FROM (${query}) as total`
      const countResult = await pool.query(countQuery, params)
      const totalCount = parseInt(countResult.rows[0].count)

      // Add pagination and ordering to the main query
      query += ` ORDER BY ssp.payment_month DESC, ssp.created_at DESC
                 LIMIT $${++paramCount} OFFSET $${++paramCount}`
      params.push(limit, (page - 1) * limit)

      const result = await pool.query(query, params)

      console.log(`[StaffSalaryController] Found ${result.rows.length} salary payments`)

      res.json({
        success: true,
        data: result.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalCount,
          pages: Math.ceil(totalCount / limit)
        },
        message: `Found ${result.rows.length} salary payments`
      })
    } catch (error) {
      console.error("[StaffSalaryController] Get salary payments error:", error)
      logger.error(`Get salary payments error: ${error.message}`)
      res.status(500).json({
        success: false,
        error: "Server error",
        details: error.message
      })
    }
  }

  /**
   * Create salary payment
   */
  static async createSalaryPayment(req, res) {
    const client = await pool.connect()

    try {
      await client.query('BEGIN')

      const { clinicId } = req.params
      const {
        staff_id,
        payment_month,
        payment_method = "bank_transfer",
        reference_number,
        notes,
        update_balance = true
      } = req.body

      console.log(`[StaffSalaryController] Creating salary payment for clinic ${clinicId}`)

      // Validate required fields
      if (!staff_id || !payment_month) {
        return res.status(400).json({
          success: false,
          error: "Staff ID and payment month are required"
        })
      }

      // Verify clinic access
      if (req.user.role === "clinic_admin") {
        const clinicAccess = await client.query(
          "SELECT 1 FROM admin_clinics WHERE admin_id = $1 AND clinic_id = $2",
          [req.user.id, clinicId]
        )
        if (clinicAccess.rows.length === 0) {
          return res.status(403).json({
            success: false,
            error: "Access denied to this clinic"
          })
        }
      }

      // Check if staff member exists and belongs to clinic
      const staffCheck = await client.query(
        `SELECT 
          monthly_salary, 
          staff_type, 
          user_id, 
          balance as current_balance 
        FROM clinic_staff 
        WHERE id = $1 AND clinic_id = $2`,
        [staff_id, clinicId]
      )
      
      if (staffCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Staff member not found"
        })
      }

      const staffData = staffCheck.rows[0]
      const monthlySalary = parseFloat(staffData.monthly_salary)

      // Check if payment already exists for this month
      const existingPayment = await client.query(
        "SELECT 1 FROM staff_salary_payments WHERE staff_id = $1 AND payment_month = $2",
        [staff_id, payment_month]
      )
      
      if (existingPayment.rows.length > 0) {
        return res.status(400).json({
          success: false,
          error: "Salary payment already exists for this month"
        })
      }

      // Calculate net salary (you might want to add more complex calculation logic)
      const netSalary = monthlySalary

      // Create salary payment record
      const paymentResult = await client.query(
        `INSERT INTO staff_salary_payments 
         (staff_id, clinic_id, payment_month, base_salary, net_salary, 
          payment_method, reference_number, notes, payment_status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          staff_id,
          clinicId,
          payment_month,
          monthlySalary,
          netSalary,
          payment_method,
          reference_number,
          notes,
          'paid',
          req.user.id
        ]
      )

      const payment = paymentResult.rows[0]

      // Optionally update staff balance
      if (update_balance) {
        let balanceUpdateQuery, balanceUpdateParams

        // Different balance update for clinic staff vs user staff
        if (staffData.staff_type === 'user_staff' && staffData.user_id) {
          balanceUpdateQuery = `
            UPDATE users 
            SET balance = COALESCE(balance, 0) + $1, 
                last_payment_date = CURRENT_TIMESTAMP 
            WHERE id = $2
            RETURNING balance
          `
          balanceUpdateParams = [netSalary, staffData.user_id]
        } else {
          balanceUpdateQuery = `
            UPDATE clinic_staff 
            SET balance = COALESCE(balance, 0) + $1, 
                last_payment_date = CURRENT_TIMESTAMP 
            WHERE id = $2
            RETURNING balance
          `
          balanceUpdateParams = [netSalary, staff_id]
        }

        const balanceResult = await client.query(balanceUpdateQuery, balanceUpdateParams)
        payment.new_balance = balanceResult.rows[0].balance
      }

      await client.query('COMMIT')

      logger.info(`Salary payment created for staff ${staff_id} at clinic ${clinicId}`)

      res.status(201).json({
        success: true,
        data: payment,
        message: "Salary payment processed successfully"
      })
    } catch (error) {
      await client.query('ROLLBACK')
      console.error("[StaffSalaryController] Create salary payment error:", error)
      logger.error(`Create salary payment error: ${error.message}`)
      res.status(500).json({
        success: false,
        error: "Server error",
        details: error.message
      })
    } finally {
      client.release()
    }
  }

  /**
   * Update salary payment status
   */
  static async updateSalaryPayment(req, res) {
    try {
      const { clinicId, paymentId } = req.params
      const { payment_status, payment_date, payment_method, payment_reference } = req.body

      console.log(`[StaffSalaryController] Updating salary payment ${paymentId} for clinic ${clinicId}`)

      // Validate clinicId and paymentId
      const clinicIdInt = parseInt(clinicId, 10)
      const paymentIdInt = parseInt(paymentId, 10)
      
      if (isNaN(clinicIdInt)) {
        return res.status(400).json({
          success: false,
          error: "Invalid clinic ID format"
        })
      }
      
      if (isNaN(paymentIdInt)) {
        return res.status(400).json({
          success: false,
          error: "Invalid payment ID format"
        })
      }

      // Validate status
      if (!["pending", "paid", "cancelled"].includes(payment_status)) {
        return res.status(400).json({
          success: false,
          error: "Invalid payment status"
        })
      }

      // Verify clinic access
      if (req.user.role === "clinic_admin") {
        const clinicAccess = await pool.query(
          "SELECT 1 FROM admin_clinics WHERE admin_id = $1 AND clinic_id = $2",
          [req.user.id, clinicIdInt]
        )
        if (clinicAccess.rows.length === 0) {
          return res.status(403).json({
            success: false,
            error: "Access denied to this clinic"
          })
        }
      }

      // Check if payment exists and belongs to clinic
      const paymentCheck = await pool.query(
        "SELECT 1 FROM staff_salary_payments WHERE id = $1 AND clinic_id = $2",
        [paymentIdInt, clinicIdInt]
      )
      if (paymentCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Salary payment not found"
        })
      }

      // Build update query
      let updateQuery = `UPDATE staff_salary_payments SET payment_status = $1`
      const params = [payment_status]
      let paramCount = 1

      if (payment_date && payment_status === 'paid') {
        updateQuery += `, payment_date = $${++paramCount}`
        params.push(payment_date)
      }

      if (payment_method && payment_status === 'paid') {
        updateQuery += `, payment_method = $${++paramCount}`
        params.push(payment_method)
      }

      if (payment_reference && payment_status === 'paid') {
        updateQuery += `, payment_reference = $${++paramCount}`
        params.push(payment_reference)
      }

      updateQuery += `, updated_at = NOW(), updated_by = $${++paramCount} WHERE id = $${++paramCount} AND clinic_id = $${++paramCount} RETURNING *`
      params.push(req.user.id, paymentIdInt, clinicIdInt)

      // Update payment
      const result = await pool.query(updateQuery, params)
      const updatedPayment = result.rows[0]

      logger.info(`Salary payment updated: ${paymentIdInt} at clinic ${clinicIdInt}`)

      res.json({
        success: true,
        data: updatedPayment,
        message: "Salary payment updated successfully"
      })
    } catch (error) {
      console.error("[StaffSalaryController] Update salary payment error:", error)
      logger.error(`Update salary payment error: ${error.message}`)
      res.status(500).json({
        success: false,
        error: "Server error",
        details: error.message
      })
    }
  }

  /**
   * Get salary adjustments for clinic
   */
  static async getSalaryAdjustments(req, res) {
    try {
      const { clinicId } = req.params
      const { page = 1, limit = 10, month, type, status, staffId } = req.query

      console.log(`[StaffSalaryController] Getting salary adjustments for clinic ${clinicId}`)

      // Validate clinicId is a valid integer
      const clinicIdInt = parseInt(clinicId, 10)
      if (isNaN(clinicIdInt)) {
        return res.status(400).json({
          success: false,
          error: "Invalid clinic ID format"
        })
      }

      // Verify clinic access
      if (req.user.role === "clinic_admin") {
        const clinicAccess = await pool.query(
          "SELECT 1 FROM admin_clinics WHERE admin_id = $1 AND clinic_id = $2",
          [req.user.id, clinicIdInt]
        )
        if (clinicAccess.rows.length === 0) {
          return res.status(403).json({
            success: false,
            error: "Access denied to this clinic"
          })
        }
      }

      // Build query
      let query = `
        SELECT 
          ssa.*,
          cs.full_name as staff_name,
          cs.position,
          u.full_name as created_by_name
        FROM staff_salary_adjustments ssa
        JOIN clinic_staff cs ON ssa.staff_id = cs.id
        LEFT JOIN users u ON ssa.created_by = u.id
        WHERE ssa.clinic_id = $1
      `
      const params = [clinicIdInt]
      let paramCount = 1

      if (month) {
        query += ` AND ssa.effective_month = $${++paramCount}`
        params.push(month)
      }

      if (type) {
        query += ` AND ssa.adjustment_type = $${++paramCount}`
        params.push(type)
      }

      if (status) {
        query += ` AND ssa.status = $${++paramCount}`
        params.push(status)
      }

      if (staffId) {
        const staffIdInt = parseInt(staffId, 10)
        if (!isNaN(staffIdInt)) {
        query += ` AND ssa.staff_id = $${++paramCount}`
          params.push(staffIdInt)
        }
      }

      // Get total count
      const countQuery = query.replace(/SELECT.*FROM/, "SELECT COUNT(*) FROM")
      const countResult = await pool.query(countQuery, params)
      const totalCount = parseInt(countResult.rows[0].count)

      // Add pagination and ordering
      query += ` ORDER BY ssa.effective_month DESC, ssa.created_at DESC
                 LIMIT $${++paramCount} OFFSET $${++paramCount}`
      params.push(limit, (page - 1) * limit)

      const result = await pool.query(query, params)

      console.log(`[StaffSalaryController] Found ${result.rows.length} salary adjustments`)

      res.json({
        success: true,
        data: result.rows,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: totalCount,
          pages: Math.ceil(totalCount / limit)
        },
        message: `Found ${result.rows.length} salary adjustments`
      })
    } catch (error) {
      console.error("[StaffSalaryController] Get salary adjustments error:", error)
      logger.error(`Get salary adjustments error: ${error.message}`)
      res.status(500).json({
        success: false,
        error: "Server error",
        details: error.message
      })
    }
  }

  /**
   * Create salary adjustment
   */
  static async createSalaryAdjustment(req, res) {
    try {
      const { clinicId } = req.params
      const {
        staff_id,
        adjustment_type,
        amount,
        reason,
        effective_month,
        status = "pending"
      } = req.body

      console.log(`[StaffSalaryController] Creating salary adjustment for clinic ${clinicId}`)

      // Validate required fields
      if (!staff_id || !adjustment_type || !amount || !reason || !effective_month) {
        return res.status(400).json({
          success: false,
          error: "Staff ID, adjustment type, amount, reason, and effective month are required"
        })
      }

      // Validate adjustment type
      if (!["bonus", "deduction", "overtime", "advance"].includes(adjustment_type)) {
        return res.status(400).json({
          success: false,
          error: "Invalid adjustment type"
        })
      }

      // Verify clinic access
      if (req.user.role === "clinic_admin") {
        const clinicAccess = await pool.query(
          "SELECT 1 FROM admin_clinics WHERE admin_id = $1 AND clinic_id = $2",
          [req.user.id, clinicId]
        )
        if (clinicAccess.rows.length === 0) {
          return res.status(403).json({
            success: false,
            error: "Access denied to this clinic"
          })
        }
      }

      // Check if staff member exists and belongs to clinic
      const staffCheck = await pool.query(
        "SELECT 1 FROM clinic_staff WHERE id = $1 AND clinic_id = $2",
        [staff_id, clinicId]
      )
      if (staffCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Staff member not found"
        })
      }

      // Create salary adjustment
      const result = await pool.query(
        `INSERT INTO staff_salary_adjustments 
         (staff_id, clinic_id, adjustment_type, amount, reason, effective_month, status, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [staff_id, clinicId, adjustment_type, amount, reason, effective_month, status, req.user.id]
      )

      const adjustment = result.rows[0]

      logger.info(`Salary adjustment created for staff ${staff_id} at clinic ${clinicId}`)

      res.status(201).json({
        success: true,
        data: adjustment,
        message: "Salary adjustment created successfully"
      })
    } catch (error) {
      console.error("[StaffSalaryController] Create salary adjustment error:", error)
      logger.error(`Create salary adjustment error: ${error.message}`)
      res.status(500).json({
        success: false,
        error: "Server error",
        details: error.message
      })
    }
  }

  /**
   * Update salary adjustment status
   */
  static async updateSalaryAdjustment(req, res) {
    try {
      const { clinicId, adjustmentId } = req.params
      const { status } = req.body

      console.log(`[StaffSalaryController] Updating salary adjustment ${adjustmentId} for clinic ${clinicId}`)

      // Validate clinicId and adjustmentId
      const clinicIdInt = parseInt(clinicId, 10)
      const adjustmentIdInt = parseInt(adjustmentId, 10)
      
      if (isNaN(clinicIdInt)) {
        return res.status(400).json({
          success: false,
          error: "Invalid clinic ID format"
        })
      }
      
      if (isNaN(adjustmentIdInt)) {
        return res.status(400).json({
          success: false,
          error: "Invalid adjustment ID format"
        })
      }

      // Validate status
      if (!["pending", "applied", "cancelled"].includes(status)) {
        return res.status(400).json({
          success: false,
          error: "Invalid status"
        })
      }

      // Verify clinic access
      if (req.user.role === "clinic_admin") {
        const clinicAccess = await pool.query(
          "SELECT 1 FROM admin_clinics WHERE admin_id = $1 AND clinic_id = $2",
          [req.user.id, clinicIdInt]
        )
        if (clinicAccess.rows.length === 0) {
          return res.status(403).json({
            success: false,
            error: "Access denied to this clinic"
          })
        }
      }

      // Check if adjustment exists and belongs to clinic
      const adjustmentCheck = await pool.query(
        "SELECT 1 FROM staff_salary_adjustments WHERE id = $1 AND clinic_id = $2",
        [adjustmentIdInt, clinicIdInt]
      )
      if (adjustmentCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: "Salary adjustment not found"
        })
      }

      // Update adjustment
      const result = await pool.query(
        `UPDATE staff_salary_adjustments 
         SET status = $1, updated_at = NOW()
         WHERE id = $2 AND clinic_id = $3
         RETURNING *`,
        [status, adjustmentIdInt, clinicIdInt]
      )

      const updatedAdjustment = result.rows[0]

      logger.info(`Salary adjustment updated: ${adjustmentIdInt} at clinic ${clinicIdInt}`)

      res.json({
        success: true,
        data: updatedAdjustment,
        message: "Salary adjustment updated successfully"
      })
    } catch (error) {
      console.error("[StaffSalaryController] Update salary adjustment error:", error)
      logger.error(`Update salary adjustment error: ${error.message}`)
      res.status(500).json({
        success: false,
        error: "Server error",
        details: error.message
      })
    }
  }

  /**
   * Get salary statistics for clinic
   */
  static async getSalaryStats(req, res) {
    try {
      const { clinicId } = req.params
      const { month } = req.query

      console.log(`[StaffSalaryController] Getting salary stats for clinic ${clinicId}`)

      // Validate clinicId is a valid integer
      const clinicIdInt = parseInt(clinicId, 10)
      if (isNaN(clinicIdInt)) {
        return res.status(400).json({
          success: false,
          error: "Invalid clinic ID format"
        })
      }

      // Verify clinic access
      if (req.user.role === "clinic_admin") {
        const clinicAccess = await pool.query(
          "SELECT 1 FROM admin_clinics WHERE admin_id = $1 AND clinic_id = $2",
          [req.user.id, clinicIdInt]
        )
        if (clinicAccess.rows.length === 0) {
          return res.status(403).json({
            success: false,
            error: "Access denied to this clinic"
          })
        }
      }

      const currentMonth = month || new Date().toISOString().slice(0, 7) + "-01"

      // Get total staff count
      const staffCountResult = await pool.query(
        "SELECT COUNT(*) as total FROM clinic_staff WHERE clinic_id = $1 AND status = 'active'",
        [clinicIdInt]
      )
      const totalStaff = parseInt(staffCountResult.rows[0].total)

      // Get total salary payments for the month
      const paymentsResult = await pool.query(
        `SELECT 
           COUNT(*) as total_payments,
           SUM(net_salary) as total_paid,
           SUM(CASE WHEN payment_status = 'paid' THEN net_salary ELSE 0 END) as paid_amount,
           SUM(CASE WHEN payment_status = 'pending' THEN net_salary ELSE 0 END) as pending_amount
         FROM staff_salary_payments 
         WHERE clinic_id = $1 AND payment_month = $2`,
        [clinicIdInt, currentMonth]
      )

      // Get total adjustments for the month
      const adjustmentsResult = await pool.query(
        `SELECT 
           COUNT(*) as total_adjustments,
           SUM(CASE WHEN adjustment_type IN ('bonus', 'overtime') THEN amount ELSE 0 END) as total_bonuses,
           SUM(CASE WHEN adjustment_type IN ('deduction', 'advance') THEN amount ELSE 0 END) as total_deductions
         FROM staff_salary_adjustments 
         WHERE clinic_id = $1 AND effective_month = $2 AND status = 'applied'`,
        [clinicIdInt, currentMonth]
      )

      const stats = {
        totalStaff,
        currentMonth,
        payments: {
          total: parseInt(paymentsResult.rows[0].total_payments) || 0,
          totalAmount: parseFloat(paymentsResult.rows[0].total_paid) || 0,
          paidAmount: parseFloat(paymentsResult.rows[0].paid_amount) || 0,
          pendingAmount: parseFloat(paymentsResult.rows[0].pending_amount) || 0
        },
        adjustments: {
          total: parseInt(adjustmentsResult.rows[0].total_adjustments) || 0,
          totalBonuses: parseFloat(adjustmentsResult.rows[0].total_bonuses) || 0,
          totalDeductions: parseFloat(adjustmentsResult.rows[0].total_deductions) || 0
        }
      }

      console.log(`[StaffSalaryController] Salary stats for clinic ${clinicIdInt}:`, stats)

      res.json({
        success: true,
        data: stats,
        message: "Salary statistics retrieved successfully"
      })
    } catch (error) {
      console.error("[StaffSalaryController] Get salary stats error:", error)
      logger.error(`Get salary stats error: ${error.message}`)
      res.status(500).json({
        success: false,
        error: "Server error",
        details: error.message
      })
    }
  }

  /**
   * Update user salary
   */
  static async updateUserSalary(req, res) {
    const client = await pool.connect()
    try {
      const { userId } = req.params
      const { base_salary } = req.body

      console.log(`[StaffSalaryController] Updating salary for user ${userId}`)

      // Validate userId is a valid integer
      const userIdInt = parseInt(userId, 10)
      if (isNaN(userIdInt)) {
        return res.status(400).json({
          success: false,
          error: "Invalid user ID format"
        })
      }

      // Check if base_salary column exists
      const columnCheckResult = await client.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.columns 
          WHERE table_name = 'users' AND column_name = 'base_salary'
        )
      `)
      const baseColumnExists = columnCheckResult.rows[0].exists

      if (!baseColumnExists) {
        // Add the column if it doesn't exist
        await client.query(`
          ALTER TABLE users 
          ADD COLUMN IF NOT EXISTS base_salary DECIMAL(10,2) DEFAULT 0
        `)
      }

      // Check if user exists and is a staff member
      const userCheck = await client.query(
        `SELECT id, role_id, status 
         FROM users 
         WHERE id = $1 AND status = 'active' 
         AND role_id IN (SELECT id FROM roles WHERE name IN ('doctor', 'nurse', 'lab_tech'))`,
        [userIdInt]
      )

      if (userCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: "User not found or not a staff member"
        })
      }

      // Update user salary
      const updateResult = await client.query(
        `UPDATE users 
         SET base_salary = $1, 
             updated_at = CURRENT_TIMESTAMP 
         WHERE id = $2 
         RETURNING id, full_name, base_salary`,
        [base_salary, userIdInt]
      )

      const updatedUser = updateResult.rows[0]

      console.log(`[StaffSalaryController] Updated salary for user ${userId}`, updatedUser)

      res.json({
        success: true,
        data: updatedUser,
        message: "User salary updated successfully"
      })
    } catch (error) {
      console.error("[StaffSalaryController] Update user salary error:", error)
      logger.error(`Update user salary error: ${error.message}`)
      res.status(500).json({
        success: false,
        error: "Server error",
        details: error.message
      })
    } finally {
      client.release()
    }
  }
}

module.exports = StaffSalaryController

 
 
 