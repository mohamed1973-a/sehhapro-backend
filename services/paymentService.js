const { pool } = require("../config/database")
const logger = require("../middleware/logger")

class PaymentService {
  /**
   * Process appointment payment based on type and payment method
   * @param {Object} params - Payment parameters
   * @param {number} params.appointmentId - Appointment ID
   * @param {number} params.patientId - Patient ID
   * @param {number} params.doctorId - Doctor ID
   * @param {string} params.appointmentType - 'telemedicine' or 'in-person'
   * @param {string} params.paymentMethod - 'balance' or 'cash'
   * @param {number} params.amount - Payment amount
   * @param {Object} params.dbTransaction - Database transaction object
   * @returns {Object} Payment result
   */
  static async processAppointmentPayment({
    appointmentId,
    patientId,
    doctorId,
    appointmentType,
    paymentMethod,
    amount,
    dbTransaction
  }) {
    // Add detailed debugging at the start
    console.log("=========================================");
    console.log("PAYMENT SERVICE CALLED WITH PARAMS:");
    console.log("appointmentId:", appointmentId);
    console.log("patientId:", patientId);
    console.log("doctorId:", doctorId);
    console.log("appointmentType:", appointmentType);
    console.log("paymentMethod:", paymentMethod);
    console.log("amount:", amount);
    console.log("dbTransaction provided:", dbTransaction ? "YES" : "NO");
    console.log("=========================================");

    // Handle different transaction object types
    let client
    let useTransaction = false
    let isTransactionWrapper = false
    
    if (dbTransaction && dbTransaction.isTransactionWrapper) {
      // Direct check for transaction wrapper flag
      client = dbTransaction
      isTransactionWrapper = true
      logger.info(`[PAYMENT] Using transaction wrapper with ID: ${dbTransaction.transactionId || 'unknown'}`)
    } else if (dbTransaction && dbTransaction.query) {
      // Transaction wrapper object from middleware (legacy detection)
      client = dbTransaction
      isTransactionWrapper = true
      logger.info(`[PAYMENT] Using legacy transaction wrapper`)
    } else if (dbTransaction && dbTransaction.client) {
      // Direct client object
      client = dbTransaction.client
      logger.info(`[PAYMENT] Using client from transaction object`)
    } else {
      // No transaction provided, use pool and manage our own transaction
      client = pool
      useTransaction = true
      logger.info(`[PAYMENT] Managing own transaction`)
    }

    try {
      if (useTransaction) {
        await client.query('BEGIN')
      }

      console.log(`[PAYMENT DEBUG] Processing payment for appointment ${appointmentId}`);
      console.log(`[PAYMENT DEBUG] Patient: ${patientId}, Amount: ${amount}, Method: ${paymentMethod}, Type: ${appointmentType}`);
      console.log(`[PAYMENT DEBUG] Transaction type: ${isTransactionWrapper ? 'Using transaction wrapper' : useTransaction ? 'Managing own transaction' : 'Using client only'}`);

      // Get patient current balance
      const patientBalanceQuery = await client.query(
        'SELECT balance FROM users WHERE id = $1',
        [patientId]
      )
      
      if (patientBalanceQuery.rows.length === 0) {
        throw new Error('Patient not found')
      }
      
      const currentBalance = patientBalanceQuery.rows[0]?.balance || 0

      // For telemedicine appointments - MUST use balance
      if (appointmentType === 'telemedicine') {
        if (paymentMethod !== 'balance') {
          throw new Error('Telemedicine appointments require balance payment')
        }

        // Check if patient has sufficient balance
        if (currentBalance < amount) {
          throw new Error(`Insufficient balance. Required: ${amount} DZD, Available: ${currentBalance} DZD`)
        }

        // Deduct the amount from patient's balance
        await client.query(
          'UPDATE users SET balance = balance - $1 WHERE id = $2',
          [amount, patientId]
        )

        logger.info(`[PAYMENT] Pending payment for patient ${patientId} (Appointment #${appointmentId}) - Amount: ${amount} DZD, Status: pending`)

        // Create PENDING transaction record for patient (money deducted)
        logger.info(`[PAYMENT] About to insert patient transaction for patient ${patientId} (Appointment #${appointmentId}) - Amount: ${amount} DZD`);
        console.log(`[PAYMENT DEBUG] Inserting patient transaction with params:`, {
          patientId,
          type: 'payment',
          amount,
          description: `Telemedicine appointment payment - Appointment #${appointmentId} (PENDING)`,
          paymentMethod: 'balance',
          status: 'pending',
          appointmentId
        });
        
        try {
          const patientTransactionResult = await client.query(
            `INSERT INTO patient_transactions 
             (patient_id, type, amount, description, payment_method, status, related_appointment_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *`,
            [
              patientId,
              'payment',
              amount,
              `Telemedicine appointment payment - Appointment #${appointmentId} (PENDING)`,
              'balance',
              'pending',
              appointmentId
            ]
          )
          
          console.log(`[PAYMENT DEBUG] Patient transaction insert result:`, patientTransactionResult.rows);
          logger.info(`[PAYMENT] Patient transaction insert result:`, patientTransactionResult.rows);
          
          if (!patientTransactionResult.rows.length) {
            logger.error(`[PAYMENT] No patient transaction row inserted for patient ${patientId} (Appointment #${appointmentId})!`);
            throw new Error('Failed to create patient transaction record');
          }
          
          // Remove platform reservation transaction - we don't need it anymore
          
          // Update appointment with payment info
          await client.query(
            'UPDATE appointments SET appointment_fee = $1, status = $2 WHERE id = $3',
            [amount, 'booked', appointmentId]
          )

          // Only commit if we started our own transaction
          if (useTransaction && !isTransactionWrapper) {
            await client.query('COMMIT')
            logger.info(`[PAYMENT] Transaction committed by payment service for appointment #${appointmentId}`)
          } else if (isTransactionWrapper) {
            logger.info(`[PAYMENT] Transaction handled by caller for appointment #${appointmentId}`)
          }

          logger.info(`[PAYMENT] Telemedicine appointment payment pending successfully for patient ${patientId} (Appointment #${appointmentId}) - Amount: ${amount} DZD`)

          return {
            success: true,
            paymentProcessed: true,
            transactionId: patientTransactionResult.rows[0].id,
            newBalance: currentBalance - amount,
            message: 'Telemedicine appointment payment pending successfully.',
            status: 'pending'
          }
        } catch (err) {
          console.error(`[PAYMENT ERROR] Failed to insert patient transaction:`, err.message);
          throw err;
        }
      }

      // For in-person appointments
      if (appointmentType === 'in-person') {
        if (paymentMethod === 'balance') {
          // Check if patient has sufficient balance
          if (currentBalance < amount) {
            throw new Error(`Insufficient balance. Required: ${amount} DZD, Available: ${currentBalance} DZD`)
          }

          // Deduct the amount from patient's balance
          await client.query(
            'UPDATE users SET balance = balance - $1 WHERE id = $2',
            [amount, patientId]
          )

          logger.info(`[PAYMENT] Pending payment for patient ${patientId} (Appointment #${appointmentId}) - Amount: ${amount} DZD, Status: pending`)

          // Create PENDING transaction record for patient (money deducted)
          logger.info(`[PAYMENT] About to insert patient transaction for patient ${patientId} (Appointment #${appointmentId}) - Amount: ${amount} DZD`);
          console.log(`[PAYMENT DEBUG] Inserting in-person patient transaction with params:`, {
            patientId,
            type: 'payment',
            amount,
            description: `In-person appointment payment - Appointment #${appointmentId} (PENDING)`,
            paymentMethod: 'balance',
            status: 'pending',
            appointmentId
          });
          
          try {
            const patientTransactionResult = await client.query(
              `INSERT INTO patient_transactions 
               (patient_id, type, amount, description, payment_method, status, related_appointment_id)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               RETURNING *`,
              [
                patientId,
                'payment',
                amount,
                `In-person appointment payment - Appointment #${appointmentId} (PENDING)`,
                'balance',
                'pending',
                appointmentId
              ]
            )
            logger.info(`[PAYMENT] Patient transaction insert result:`, patientTransactionResult.rows);
            if (!patientTransactionResult.rows.length) {
              logger.error(`[PAYMENT] No patient transaction row inserted for patient ${patientId} (Appointment #${appointmentId})!`);
              throw new Error('Failed to create patient transaction record');
            }
            
            // Remove platform reservation transaction - we don't need it anymore
            
            // Update appointment with payment info
            await client.query(
              'UPDATE appointments SET appointment_fee = $1, status = $2 WHERE id = $3',
              [amount, 'booked', appointmentId]
            )

            // Only commit if we started our own transaction
            if (useTransaction && !isTransactionWrapper) {
              await client.query('COMMIT')
              logger.info(`[PAYMENT] Transaction committed by payment service for appointment #${appointmentId}`)
            } else if (isTransactionWrapper) {
              logger.info(`[PAYMENT] Transaction handled by caller for appointment #${appointmentId}`)
            }

            logger.info(`[PAYMENT] In-person appointment payment pending successfully for patient ${patientId} (Appointment #${appointmentId}) - Amount: ${amount} DZD`)

            return {
              success: true,
              paymentProcessed: true,
              transactionId: patientTransactionResult.rows[0].id,
              newBalance: currentBalance - amount,
              message: 'In-person appointment payment pending successfully.',
              status: 'pending'
            }
          } catch (err) {
            console.error(`[PAYMENT ERROR] Failed to insert in-person patient transaction:`, err.message);
            throw err;
          }
        } else {
          // Cash payment for in-person - just confirm appointment
          await client.query(
            'UPDATE appointments SET appointment_fee = $1, status = $2 WHERE id = $3',
            [amount, 'booked', appointmentId]
          )

          // Only commit if we started our own transaction
          if (useTransaction && !isTransactionWrapper) {
            await client.query('COMMIT')
            logger.info(`[PAYMENT] Transaction committed by payment service for appointment #${appointmentId}`)
          } else if (isTransactionWrapper) {
            logger.info(`[PAYMENT] Transaction handled by caller for appointment #${appointmentId}`)
          }

          return {
            success: true,
            paymentProcessed: false,
            message: 'In-person appointment confirmed with cash payment',
            status: 'pending'
          }
        }
      }

      throw new Error('Invalid appointment type')

    } catch (error) {
      // Only rollback if we started our own transaction
      if (useTransaction && !isTransactionWrapper) {
        await client.query('ROLLBACK')
        logger.error(`[PAYMENT] Transaction rolled back by payment service: ${error.message}`)
      }
      logger.error(`Payment processing error: ${error.message}`)
      throw error
    }
  }

  /**
   * Process payment when appointment is completed
   * @param {Object} params - Payment parameters
   * @param {number} params.appointmentId - Appointment ID
   * @param {number} params.patientId - Patient ID
   * @param {number} params.doctorId - Doctor ID
   * @param {string} params.appointmentType - 'telemedicine' or 'in-person'
   * @param {Object} params.dbTransaction - Database transaction object
   * @returns {Object} Payment result
   */
  static async processCompletionPayment({
    appointmentId,
    patientId,
    doctorId,
    appointmentType,
    dbTransaction
  }) {
    let client
    let useTransaction = false
    let isTransactionWrapper = false

    if (dbTransaction && dbTransaction.isTransactionWrapper) {
      // Direct check for transaction wrapper flag
      client = dbTransaction
      isTransactionWrapper = true
      logger.info(`[PAYMENT] Using transaction wrapper with ID: ${dbTransaction.transactionId || 'unknown'}`)
    } else if (dbTransaction && dbTransaction.query) {
      // Transaction wrapper object from middleware (legacy detection)
      client = dbTransaction
      isTransactionWrapper = true
      logger.info(`[PAYMENT] Using legacy transaction wrapper`)
    } else if (dbTransaction && dbTransaction.client) {
      // Direct client object
      client = dbTransaction.client
      logger.info(`[PAYMENT] Using client from transaction object`)
    } else {
      // No transaction provided, use pool and manage our own transaction
      client = pool
      useTransaction = true
      logger.info(`[PAYMENT] Managing own transaction`)
    }

    try {
      if (useTransaction) {
        await client.query('BEGIN')
      }

      // Get appointment details
      const appointmentQuery = await client.query(
        'SELECT appointment_fee, status FROM appointments WHERE id = $1',
        [appointmentId]
      )

      if (appointmentQuery.rows.length === 0) {
        throw new Error('Appointment not found')
      }

      const appointment = appointmentQuery.rows[0]
      const appointmentFee = appointment.appointment_fee || 0

      if (appointmentFee <= 0) {
        // No fee to process
        if (useTransaction) {
          await client.query('COMMIT')
        }
        return {
          success: true,
          paymentProcessed: false,
          message: 'No payment to process for this appointment'
        }
      }

      // Get doctor's current balance
      const doctorBalanceQuery = await client.query(
        'SELECT balance FROM users WHERE id = $1',
        [doctorId]
      )
      
      if (doctorBalanceQuery.rows.length === 0) {
        throw new Error('Doctor not found')
      }
      
      const doctorCurrentBalance = doctorBalanceQuery.rows[0]?.balance || 0

      // Check if there's a pending payment for this appointment
      const pendingPaymentQuery = await client.query(
        `SELECT id, status FROM patient_transactions 
         WHERE related_appointment_id = $1 AND patient_id = $2 AND type = 'payment' AND status = 'pending'`,
        [appointmentId, patientId]
      )

      if (pendingPaymentQuery.rows.length > 0) {
        // There's a pending payment - complete it and transfer to doctor
        
        // 1. Update patient transaction to completed
        await client.query(
          `UPDATE patient_transactions 
           SET status = 'completed', 
               description = CONCAT(description, ' - COMPLETED')
           WHERE related_appointment_id = $1 AND patient_id = $2 AND type = 'payment' AND status = 'pending'`,
          [appointmentId, patientId]
        )

        logger.info(`[PAYMENT] Patient transaction completed for patient ${patientId} (Appointment #${appointmentId})`);

        // 2. No need to update platform reservation - it doesn't exist anymore

        // 3. Add payment to doctor's balance
        await client.query(
          'UPDATE users SET balance = balance + $1 WHERE id = $2',
          [appointmentFee, doctorId]
        )

        logger.info(`[PAYMENT] Doctor ${doctorId} received payment for appointment #${appointmentId} - Amount: ${appointmentFee} DZD`);

        // Only commit if we started our own transaction
        if (useTransaction && !isTransactionWrapper) {
          await client.query('COMMIT')
          logger.info(`[PAYMENT] Completion transaction committed by payment service for appointment #${appointmentId}`)
        } else if (isTransactionWrapper) {
          logger.info(`[PAYMENT] Completion transaction handled by caller for appointment #${appointmentId}`)
        }

        return {
          success: true,
          paymentProcessed: true,
          doctorNewBalance: doctorCurrentBalance + appointmentFee,
          message: `${appointmentType} payment completed and transferred to doctor`
        }
      } else {
        // No pending payment - this is a cash payment
        // Add payment to doctor's balance
        await client.query(
          'UPDATE users SET balance = balance + $1 WHERE id = $2',
          [appointmentFee, doctorId]
        )

        // Create doctor transaction record for cash payment
        await client.query(
          `INSERT INTO patient_transactions 
           (patient_id, type, amount, description, payment_method, status, related_appointment_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            doctorId,
            'deposit',
            appointmentFee,
            `Cash ${appointmentType} appointment income - Appointment #${appointmentId}`,
            'cash',
            'completed',
            appointmentId
          ]
        )

        // Only commit if we started our own transaction
        if (useTransaction && !isTransactionWrapper) {
          await client.query('COMMIT')
          logger.info(`[PAYMENT] Cash payment transaction committed by payment service for appointment #${appointmentId}`)
        } else if (isTransactionWrapper) {
          logger.info(`[PAYMENT] Cash payment transaction handled by caller for appointment #${appointmentId}`)
        }

        return {
          success: true,
          paymentProcessed: true,
          doctorNewBalance: doctorCurrentBalance + appointmentFee,
          message: `Cash ${appointmentType} payment recorded and transferred to doctor`
        }
      }

    } catch (error) {
      // Only rollback if we started our own transaction
      if (useTransaction && !isTransactionWrapper) {
        await client.query('ROLLBACK')
        logger.error(`[PAYMENT] Completion transaction rolled back by payment service: ${error.message}`)
      }
      logger.error(`Completion payment error: ${error.message}`)
      throw error
    }
  }

  /**
   * Process refund when appointment is cancelled or failed
   * @param {Object} params - Refund parameters
   * @param {number} params.appointmentId - Appointment ID
   * @param {number} params.patientId - Patient ID
   * @param {string} params.reason - Reason for refund
   * @param {Object} params.dbTransaction - Database transaction object
   * @returns {Object} Refund result
   */
  static async processRefund({
    appointmentId,
    patientId,
    reason,
    dbTransaction
  }) {
    let client
    let useTransaction = false
    let isTransactionWrapper = false

    if (dbTransaction && dbTransaction.isTransactionWrapper) {
      // Direct check for transaction wrapper flag
      client = dbTransaction
      isTransactionWrapper = true
      logger.info(`[PAYMENT] Using transaction wrapper with ID: ${dbTransaction.transactionId || 'unknown'}`)
    } else if (dbTransaction && dbTransaction.query) {
      // Transaction wrapper object from middleware (legacy detection)
      client = dbTransaction
      isTransactionWrapper = true
      logger.info(`[PAYMENT] Using legacy transaction wrapper`)
    } else if (dbTransaction && dbTransaction.client) {
      // Direct client object
      client = dbTransaction.client
      logger.info(`[PAYMENT] Using client from transaction object`)
    } else {
      // No transaction provided, use pool and manage our own transaction
      client = pool
      useTransaction = true
      logger.info(`[PAYMENT] Managing own transaction`)
    }

    try {
      if (useTransaction) {
        await client.query('BEGIN')
      }

      // Get appointment details
      const appointmentQuery = await client.query(
        'SELECT appointment_fee, status, type FROM appointments WHERE id = $1',
        [appointmentId]
      )

      if (appointmentQuery.rows.length === 0) {
        throw new Error('Appointment not found')
      }

      const appointment = appointmentQuery.rows[0]
      const appointmentFee = appointment.appointment_fee || 0

      if (appointmentFee <= 0) {
        // No fee to refund
        if (useTransaction) {
          await client.query('COMMIT')
        }
        return {
          success: true,
          refundProcessed: false,
          message: 'No payment to refund for this appointment'
        }
      }

      // Get patient's current balance
      const patientBalanceQuery = await client.query(
        'SELECT balance FROM users WHERE id = $1',
        [patientId]
      )
      const currentBalance = patientBalanceQuery.rows[0]?.balance || 0

      // Add refund to patient balance
      await client.query(
        'UPDATE users SET balance = balance + $1 WHERE id = $2',
        [appointmentFee, patientId]
      )

      // Update patient payment transaction to cancelled
      await client.query(
        `UPDATE patient_transactions 
         SET status = 'cancelled', 
             description = CONCAT(description, ' - CANCELLED: ${reason}')
         WHERE related_appointment_id = $1 AND patient_id = $2 AND type = 'payment' AND status = 'pending'`,
        [appointmentId, patientId]
      )

      // Create refund transaction record
      const refundTransactionResult = await client.query(
        `INSERT INTO patient_transactions 
         (patient_id, type, amount, description, payment_method, status, related_appointment_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          patientId,
          'refund',
          appointmentFee,
          `Appointment refund - ${reason} - Appointment #${appointmentId}`,
          'balance',
          'completed',
          appointmentId
        ]
      )

      // Update appointment status
      await client.query(
        'UPDATE appointments SET status = $1 WHERE id = $2',
        ['cancelled', appointmentId]
      )

      // Only commit if we started our own transaction
      if (useTransaction && !isTransactionWrapper) {
        await client.query('COMMIT')
        logger.info(`[PAYMENT] Refund transaction committed by payment service for appointment #${appointmentId}`)
      } else if (isTransactionWrapper) {
        logger.info(`[PAYMENT] Refund transaction handled by caller for appointment #${appointmentId}`)
      }

      return {
        success: true,
        refundProcessed: true,
        transactionId: refundTransactionResult.rows[0].id,
        newBalance: currentBalance + appointmentFee,
        amount: appointmentFee,
        message: `Refund of ${appointmentFee} DZD processed successfully`
      }

    } catch (error) {
      // Only rollback if we started our own transaction
      if (useTransaction && !isTransactionWrapper) {
        await client.query('ROLLBACK')
        logger.error(`[PAYMENT] Refund transaction rolled back by payment service: ${error.message}`)
      }
      logger.error(`Refund processing error: ${error.message}`)
      throw error
    }
  }

  /**
   * Get appointment payment status
   * @param {number} appointmentId - Appointment ID
   * @returns {Object} Payment status
   */
  static async getPaymentStatus(appointmentId) {
    try {
      const appointmentQuery = await pool.query(
        `SELECT a.appointment_fee, a.status, a.type,
                pt.type as transaction_type, pt.status as transaction_status
         FROM appointments a
         LEFT JOIN patient_transactions pt ON a.id = pt.related_appointment_id AND pt.type = 'payment'
         WHERE a.id = $1`,
        [appointmentId]
      )

      if (appointmentQuery.rows.length === 0) {
        throw new Error('Appointment not found')
      }

      const appointment = appointmentQuery.rows[0]
      
      return {
        appointmentFee: appointment.appointment_fee || 0,
        appointmentStatus: appointment.status,
        appointmentType: appointment.type,
        paymentProcessed: appointment.transaction_type === 'payment',
        paymentStatus: appointment.transaction_status || null
      }

    } catch (error) {
      logger.error(`Get payment status error: ${error.message}`)
      throw error
    }
  }
}

module.exports = PaymentService
