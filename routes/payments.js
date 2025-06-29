const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');
const PaymentService = require('../services/paymentService');

// Validation middleware
const validate = (req, res, next) => {
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }
  next()
}

// Process appointment payment
router.post(
  '/appointment/:appointmentId',
  protect,
  [
    body('paymentMethod').isIn(['balance', 'cash']).withMessage('Payment method must be balance or cash'),
    body('amount').isFloat({ min: 0 }).withMessage('Amount must be a positive number'),
  ],
  validate,
  async (req, res) => {
    try {
      const { appointmentId } = req.params;
      const { paymentMethod, amount } = req.body;
      const userId = req.user.id;

      // Get appointment details
      const { pool } = require('../config/database');
      const appointmentQuery = await pool.query(
        'SELECT * FROM appointments WHERE id = $1 AND patient_id = $2',
        [appointmentId, userId]
      );

      if (appointmentQuery.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Appointment not found or access denied'
        });
      }

      const appointment = appointmentQuery.rows[0];

      // Process payment
      const paymentResult = await PaymentService.processAppointmentPayment({
        appointmentId: parseInt(appointmentId),
        patientId: appointment.patient_id,
        doctorId: appointment.doctor_id,
        appointmentType: appointment.type,
        paymentMethod,
        amount
      });

      res.json({
        success: true,
        data: paymentResult,
        message: paymentResult.message
      });

    } catch (error) {
      console.error('Payment processing error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Payment processing failed'
      });
    }
  }
);

// Get payment status for an appointment
router.get(
  '/appointment/:appointmentId/status',
  protect,
  async (req, res) => {
    try {
      const { appointmentId } = req.params;
      const userId = req.user.id;

      // Get appointment details
      const { pool } = require('../config/database');
      const appointmentQuery = await pool.query(
        'SELECT * FROM appointments WHERE id = $1 AND (patient_id = $2 OR doctor_id = $2)',
        [appointmentId, userId]
      );

      if (appointmentQuery.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Appointment not found or access denied'
        });
      }

      // Get payment status
      const paymentStatus = await PaymentService.getPaymentStatus(parseInt(appointmentId));

      res.json({
        success: true,
        data: paymentStatus
      });

    } catch (error) {
      console.error('Get payment status error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to get payment status'
      });
    }
  }
);

// Process refund for cancelled appointment
router.post(
  '/appointment/:appointmentId/refund',
  protect,
  [
    body('reason').optional().isString().withMessage('Reason must be a string'),
  ],
  validate,
  async (req, res) => {
    try {
      const { appointmentId } = req.params;
      const { reason = 'Appointment cancelled' } = req.body;
      const userId = req.user.id;

      // Get appointment details
      const { pool } = require('../config/database');
      const appointmentQuery = await pool.query(
        'SELECT * FROM appointments WHERE id = $1 AND patient_id = $2',
        [appointmentId, userId]
      );

      if (appointmentQuery.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'Appointment not found or access denied'
        });
      }

      const appointment = appointmentQuery.rows[0];

      // Process refund
      const refundResult = await PaymentService.processRefund({
        appointmentId: parseInt(appointmentId),
        patientId: appointment.patient_id,
        reason
      });

      res.json({
        success: true,
        data: refundResult,
        message: refundResult.message
      });

    } catch (error) {
      console.error('Refund processing error:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Refund processing failed'
      });
    }
  }
);

module.exports = router; 
 
 
 