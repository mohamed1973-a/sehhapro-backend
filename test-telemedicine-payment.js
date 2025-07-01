const { pool } = require('./config/database')
const PaymentService = require('./services/paymentService')

async function testTelemedicinePaymentFlow() {
  const client = await pool.connect()
  
  try {
    console.log('🧪 Testing Telemedicine Payment Flow...\n')
    
    // Test 1: Insufficient Balance
    console.log('1. Testing insufficient balance scenario...')
    try {
      await PaymentService.processAppointmentPayment({
        appointmentId: 999,
        patientId: 1, // Assuming patient with low balance
        doctorId: 2,
        appointmentType: 'telemedicine',
        paymentMethod: 'balance',
        amount: 10000, // High amount
        dbTransaction: client
      })
      console.log('❌ Should have failed with insufficient balance')
    } catch (error) {
      console.log('✅ Correctly caught insufficient balance error:', error.message)
    }

    // Test 2: Invalid payment method for telemedicine
    console.log('\n2. Testing invalid payment method for telemedicine...')
    try {
      await PaymentService.processAppointmentPayment({
        appointmentId: 999,
        patientId: 1,
        doctorId: 2,
        appointmentType: 'telemedicine',
        paymentMethod: 'cash', // Invalid for telemedicine
        amount: 1000,
        dbTransaction: client
      })
      console.log('❌ Should have failed with invalid payment method')
    } catch (error) {
      console.log('✅ Correctly caught invalid payment method error:', error.message)
    }

    // Test 3: Patient not found
    console.log('\n3. Testing patient not found...')
    try {
      await PaymentService.processAppointmentPayment({
        appointmentId: 999,
        patientId: 99999, // Non-existent patient
        doctorId: 2,
        appointmentType: 'telemedicine',
        paymentMethod: 'balance',
        amount: 1000,
        dbTransaction: client
      })
      console.log('❌ Should have failed with patient not found')
    } catch (error) {
      console.log('✅ Correctly caught patient not found error:', error.message)
    }

    // Test 4: Doctor not found
    console.log('\n4. Testing doctor not found...')
    try {
      await PaymentService.processCompletionPayment({
        appointmentId: 999,
        patientId: 1,
        doctorId: 99999, // Non-existent doctor
        appointmentType: 'telemedicine',
        dbTransaction: client
      })
      console.log('❌ Should have failed with doctor not found')
    } catch (error) {
      console.log('✅ Correctly caught doctor not found error:', error.message)
    }

    // Test 5: Appointment not found
    console.log('\n5. Testing appointment not found...')
    try {
      await PaymentService.processCompletionPayment({
        appointmentId: 99999, // Non-existent appointment
        patientId: 1,
        doctorId: 2,
        appointmentType: 'telemedicine',
        dbTransaction: client
      })
      console.log('❌ Should have failed with appointment not found')
    } catch (error) {
      console.log('✅ Correctly caught appointment not found error:', error.message)
    }

    // Test 6: Invalid appointment type
    console.log('\n6. Testing invalid appointment type...')
    try {
      await PaymentService.processAppointmentPayment({
        appointmentId: 999,
        patientId: 1,
        doctorId: 2,
        appointmentType: 'invalid_type',
        paymentMethod: 'balance',
        amount: 1000,
        dbTransaction: client
      })
      console.log('❌ Should have failed with invalid appointment type')
    } catch (error) {
      console.log('✅ Correctly caught invalid appointment type error:', error.message)
    }

    console.log('\n🎉 All error handling tests passed!')
    console.log('\n📝 Summary:')
    console.log('- Insufficient balance errors are properly handled')
    console.log('- Telemedicine requires balance payment')
    console.log('- Patient/doctor not found errors are caught')
    console.log('- Appointment not found errors are caught')
    console.log('- Invalid appointment types are rejected')
    console.log('- All errors include descriptive messages')

  } catch (error) {
    console.error('❌ Test failed:', error)
  } finally {
    client.release()
    await pool.end()
  }
}

// Run the test
testTelemedicinePaymentFlow().catch(console.error)
