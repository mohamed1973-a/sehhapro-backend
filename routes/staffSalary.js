/**
 * Staff Salary Routes
 *
 * Routes for managing clinic staff salaries, payments, and adjustments.
 */

const express = require("express")
const router = express.Router()
const { protect, role } = require("../middleware/auth")
const StaffSalaryController = require("../controllers/staffSalaryController")
const { body, query, validationResult } = require("express-validator")

// Validation middleware
const validate = (req, res, next) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }
  next()
}

// All routes require authentication
router.use(protect)

// =====================================================
// CLINIC STAFF MANAGEMENT (Non-user staff)
// =====================================================

// Get all clinic staff (both users and non-users)
router.get(
  "/clinics/:clinicId/staff",
  role(["platform_admin", "clinic_admin"]),
  StaffSalaryController.getClinicStaff
)

// Create new clinic staff member (non-user)
router.post(
  "/clinics/:clinicId/staff",
  role(["platform_admin", "clinic_admin"]),
  [
    body("full_name").notEmpty().withMessage("Full name is required"),
    body("position").notEmpty().withMessage("Position is required"),
    body("monthly_salary").isNumeric().withMessage("Monthly salary must be a number"),
    body("employment_type").optional().isIn(["full_time", "part_time", "contract", "temporary"]).withMessage("Invalid employment type"),
    body("email").optional().isEmail().withMessage("Invalid email address"),
    body("phone").optional().isMobilePhone().withMessage("Invalid phone number"),
  ],
  validate,
  StaffSalaryController.createClinicStaff
)

// Update clinic staff member
router.put(
  "/clinics/:clinicId/staff/:staffId",
  role(["platform_admin", "clinic_admin"]),
  [
    body("full_name").optional().notEmpty().withMessage("Full name cannot be empty"),
    body("position").optional().notEmpty().withMessage("Position cannot be empty"),
    body("monthly_salary").optional().isNumeric().withMessage("Monthly salary must be a number"),
    body("employment_type").optional().isIn(["full_time", "part_time", "contract", "temporary"]).withMessage("Invalid employment type"),
    body("status").optional().isIn(["active", "inactive", "terminated"]).withMessage("Invalid status"),
    body("email").optional().isEmail().withMessage("Invalid email address"),
    body("phone").optional().isMobilePhone().withMessage("Invalid phone number"),
  ],
  validate,
  StaffSalaryController.updateClinicStaff
)

// Delete clinic staff member
router.delete(
  "/clinics/:clinicId/staff/:staffId",
  role(["platform_admin", "clinic_admin"]),
  StaffSalaryController.deleteClinicStaff
)

// =====================================================
// SALARY PAYMENTS MANAGEMENT
// =====================================================

// Get salary payments for clinic
router.get(
  "/clinics/:clinicId/payments",
  role(["platform_admin", "clinic_admin"]),
  [
    query("page").optional().isInt({ min: 1 }).withMessage("Page must be a positive integer"),
    query("limit").optional().isInt({ min: 1, max: 100 }).withMessage("Limit must be between 1 and 100"),
    query("month").optional().isISO8601().withMessage("Invalid month format"),
    query("status").optional().isIn(["pending", "paid", "cancelled"]).withMessage("Invalid status"),
    query("staffId").optional().isInt({ min: 1 }).withMessage("Invalid staff ID"),
  ],
  validate,
  StaffSalaryController.getSalaryPayments
)

// Create salary payment
router.post(
  "/clinics/:clinicId/payments",
  role(["platform_admin", "clinic_admin"]),
  [
    body("staff_id").isInt({ min: 1 }).withMessage("Invalid staff ID"),
    body("payment_month").isISO8601().withMessage("Invalid payment month format"),
    body("payment_method").optional().isIn([
      "bank_transfer", 
      "cash", 
      "check"
    ]).withMessage("Invalid payment method"),
    body("reference_number").optional().isString().withMessage("Reference number must be a string"),
    body("notes").optional().isString().withMessage("Notes must be a string"),
    body("update_balance").optional().isBoolean().withMessage("Update balance must be a boolean")
  ],
  validate,
  StaffSalaryController.createSalaryPayment
)

// Update salary payment
router.put(
  "/clinics/:clinicId/payments/:paymentId",
  role(["platform_admin", "clinic_admin"]),
  [
    body("payment_status").optional().isIn(["pending", "paid", "cancelled"]).withMessage("Invalid payment status"),
    body("payment_date").optional().isISO8601().withMessage("Invalid payment date format"),
    body("reference_number").optional().isString().withMessage("Reference number must be a string"),
    body("notes").optional().isString().withMessage("Notes must be a string"),
  ],
  validate,
  StaffSalaryController.updateSalaryPayment
)

// =====================================================
// SALARY ADJUSTMENTS MANAGEMENT
// =====================================================

// Get salary adjustments for clinic
router.get(
  "/clinics/:clinicId/adjustments",
  role(["platform_admin", "clinic_admin"]),
  [
    query("page").optional().isInt({ min: 1 }).withMessage("Page must be a positive integer"),
    query("limit").optional().isInt({ min: 1, max: 100 }).withMessage("Limit must be between 1 and 100"),
    query("month").optional().isISO8601().withMessage("Invalid month format"),
    query("type").optional().isIn(["bonus", "deduction", "overtime", "advance"]).withMessage("Invalid adjustment type"),
    query("status").optional().isIn(["pending", "applied", "cancelled"]).withMessage("Invalid status"),
    query("staffId").optional().isInt({ min: 1 }).withMessage("Invalid staff ID"),
  ],
  validate,
  StaffSalaryController.getSalaryAdjustments
)

// Create salary adjustment
router.post(
  "/clinics/:clinicId/adjustments",
  role(["platform_admin", "clinic_admin"]),
  [
    body("staff_id").isInt({ min: 1 }).withMessage("Valid staff ID is required"),
    body("adjustment_type").isIn(["bonus", "deduction", "overtime", "advance"]).withMessage("Valid adjustment type is required"),
    body("amount").isNumeric({ min: 0 }).withMessage("Amount must be a positive number"),
    body("reason").notEmpty().withMessage("Reason is required"),
    body("effective_month").isISO8601().withMessage("Valid effective month is required"),
    body("status").optional().isIn(["pending", "applied", "cancelled"]).withMessage("Invalid status"),
  ],
  validate,
  StaffSalaryController.createSalaryAdjustment
)

// Update salary adjustment status
router.put(
  "/clinics/:clinicId/adjustments/:adjustmentId",
  role(["platform_admin", "clinic_admin"]),
  [
    body("status").isIn(["pending", "applied", "cancelled"]).withMessage("Valid status is required"),
  ],
  validate,
  StaffSalaryController.updateSalaryAdjustment
)

// =====================================================
// SALARY STATISTICS
// =====================================================

// Get salary statistics for clinic
router.get(
  "/clinics/:clinicId/stats",
  role(["platform_admin", "clinic_admin"]),
  [
    query("month").optional().isISO8601().withMessage("Invalid month format"),
  ],
  validate,
  StaffSalaryController.getSalaryStats
)

// =====================================================
// USER SALARY MANAGEMENT
// =====================================================

// Update user salary
router.put(
  "/users/:userId/salary",
  role(["platform_admin", "clinic_admin"]),
  [
    body("base_salary").isNumeric().withMessage("Base salary must be a number"),
  ],
  validate,
  StaffSalaryController.updateUserSalary
)

// =====================================================
// DOCTOR EARNINGS
// =====================================================

// Get doctor earnings
router.get(
  "/doctor/earnings",
  role(["doctor"]),
  StaffSalaryController.getDoctorEarnings
)

module.exports = router
