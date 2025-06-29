# Telemedicine Payment Flow System

## Overview

The telemedicine payment flow system provides a comprehensive solution for handling payments for both telemedicine and in-person appointments. The system supports balance and cash payment methods with automatic payment processing and refund capabilities.

## Features

### 1. **Telemedicine Appointments**
- **Balance Payment**: Deducts payment from patient's balance immediately upon booking
- **Cash Payment**: Confirms appointment without immediate payment (collected during session)
- **Automatic Completion Payment**: Transfers payment to doctor's account when appointment is completed

### 2. **In-Person Appointments**
- **Balance Payment**: Deducts payment from patient's balance immediately upon booking
- **Cash Payment**: Confirms appointment without immediate payment (collected at clinic)
- **Automatic Completion Payment**: Transfers payment to doctor's account when appointment is completed

### 3. **Payment Processing**
- **Real-time Balance Validation**: Checks patient balance before processing payments
- **Transaction Recording**: Creates detailed transaction records for all payments
- **Automatic Refunds**: Processes refunds when appointments are cancelled

## System Architecture

### Backend Components

#### 1. **PaymentService** (`backend/services/paymentService.js`)
Core service handling all payment operations:

```javascript
// Process appointment payment
static async processAppointmentPayment({
  appointmentId,
  patientId,
  doctorId,
  appointmentType,
  paymentMethod,
  amount,
  dbTransaction
})

// Process completion payment
static async processCompletionPayment({
  appointmentId,
  patientId,
  doctorId,
  appointmentType,
  dbTransaction
})

// Process refund
static async processRefund({
  appointmentId,
  patientId,
  reason,
  dbTransaction
})

// Get payment status
static async getPaymentStatus(appointmentId)
```

#### 2. **Payment Routes** (`backend/routes/payments.js`)
API endpoints for payment operations:

- `POST /api/payments/appointment/:appointmentId` - Process payment
- `GET /api/payments/appointment/:appointmentId/status` - Get payment status
- `POST /api/payments/appointment/:appointmentId/refund` - Process refund

#### 3. **Updated Appointment Controller**
Enhanced appointment controller with payment integration:

- **Create Appointment**: Includes payment processing during booking
- **End Telemedicine Session**: Automatically processes completion payment
- **Check Out**: Automatically processes completion payment for in-person appointments
- **Cancel Appointment**: Automatically processes refunds

### Frontend Components

#### 1. **AppointmentPaymentFlow** (`frontend/components/appointments/appointment-payment-flow.tsx`)
React component for payment interface:

```typescript
interface AppointmentPaymentFlowProps {
  appointmentId: number
  appointmentType: 'telemedicine' | 'in-person'
  appointmentFee: number
  patientBalance: number
  onPaymentComplete: (result: any) => void
  onCancel: () => void
}
```

#### 2. **Frontend API Routes**
Next.js API routes for payment operations:

- `frontend/app/api/payments/appointment/[appointmentId]/route.ts`
- `frontend/app/api/payments/appointment/[appointmentId]/status/route.ts`
- `frontend/app/api/payments/appointment/[appointmentId]/refund/route.ts`

## Payment Flow Logic

### 1. **Telemedicine Appointment Booking**

#### Balance Payment Flow:
1. Patient selects balance payment method
2. System validates sufficient balance
3. Payment is deducted from patient's balance immediately
4. Transaction record is created
5. Appointment is confirmed with "booked" status
6. When appointment is completed, payment is transferred to doctor's account

#### Cash Payment Flow:
1. Patient selects cash payment method
2. Appointment is confirmed without immediate payment
3. Payment is collected during the telemedicine session
4. When appointment is completed, payment is transferred to doctor's account

### 2. **In-Person Appointment Booking**

#### Balance Payment Flow:
1. Patient selects balance payment method
2. System validates sufficient balance
3. Payment is deducted from patient's balance immediately
4. Transaction record is created
5. Appointment is confirmed with "booked" status
6. When appointment is completed, payment is transferred to doctor's account

#### Cash Payment Flow:
1. Patient selects cash payment method
2. Appointment is confirmed without immediate payment
3. Payment is collected at the clinic
4. When appointment is completed, payment is transferred to doctor's account

### 3. **Appointment Completion**

For both telemedicine and in-person appointments:
1. Doctor ends session or checks out patient
2. System automatically processes completion payment
3. Payment amount is transferred to doctor's balance
4. Transaction record is created for doctor
5. Appointment status is updated to "completed"

### 4. **Appointment Cancellation**

When appointment is cancelled:
1. System checks if payment was made
2. If payment was made, automatic refund is processed
3. Payment amount is returned to patient's balance
4. Refund transaction record is created
5. Appointment status is updated to "cancelled"

## Database Schema

### Patient Transactions Table
```sql
CREATE TABLE patient_transactions (
  id SERIAL PRIMARY KEY,
  patient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL CHECK (type IN ('deposit', 'withdrawal', 'payment', 'refund')),
  amount DECIMAL(10,2) NOT NULL,
  description TEXT,
  payment_method VARCHAR(50),
  reference_number VARCHAR(100),
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed', 'cancelled')),
  related_appointment_id INTEGER REFERENCES appointments(id) ON DELETE SET NULL,
  related_telemedicine_session_id INTEGER REFERENCES telemedicine_sessions(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### Appointments Table (Updated)
```sql
ALTER TABLE appointments ADD COLUMN appointment_fee DECIMAL(10,2);
```

## API Endpoints

### Create Appointment with Payment
```http
POST /api/appointments
Content-Type: application/json
Authorization: Bearer <token>

{
  "doctorId": 123,
  "clinicId": 456,
  "date": "2024-01-15T10:00:00Z",
  "reason": "Regular checkup",
  "type": "telemedicine",
  "paymentMethod": "balance",
  "appointmentFee": 5000.00
}
```

### Process Payment
```http
POST /api/payments/appointment/123
Content-Type: application/json
Authorization: Bearer <token>

{
  "paymentMethod": "balance",
  "amount": 5000.00
}
```

### Get Payment Status
```http
GET /api/payments/appointment/123/status
Authorization: Bearer <token>
```

### Process Refund
```http
POST /api/payments/appointment/123/refund
Content-Type: application/json
Authorization: Bearer <token>

{
  "reason": "Appointment cancelled by patient"
}
```

## Error Handling

### Insufficient Balance
```json
{
  "success": false,
  "error": "Insufficient balance for telemedicine appointment",
  "code": "PAYMENT_FAILED"
}
```

### Payment Processing Errors
```json
{
  "success": false,
  "message": "Payment processing failed",
  "details": "Database connection error"
}
```

## Security Considerations

1. **Authentication**: All payment endpoints require valid authentication
2. **Authorization**: Users can only access their own payment data
3. **Transaction Safety**: All payment operations use database transactions
4. **Input Validation**: All payment amounts and methods are validated
5. **Audit Trail**: All payment transactions are logged with timestamps

## Testing

### Test Scenarios

1. **Telemedicine Balance Payment**
   - Patient with sufficient balance books telemedicine appointment
   - Payment is deducted immediately
   - Doctor completes session, payment transferred to doctor

2. **Telemedicine Cash Payment**
   - Patient books telemedicine appointment with cash payment
   - No immediate payment deduction
   - Doctor completes session, payment transferred to doctor

3. **In-Person Balance Payment**
   - Patient with sufficient balance books in-person appointment
   - Payment is deducted immediately
   - Doctor checks out patient, payment transferred to doctor

4. **In-Person Cash Payment**
   - Patient books in-person appointment with cash payment
   - No immediate payment deduction
   - Doctor checks out patient, payment transferred to doctor

5. **Insufficient Balance**
   - Patient with insufficient balance tries to book appointment
   - Payment is rejected with appropriate error message

6. **Appointment Cancellation**
   - Patient cancels paid appointment
   - Refund is processed automatically
   - Patient balance is updated

## Deployment Notes

1. **Database Migration**: Ensure patient_transactions table exists
2. **Environment Variables**: Set BACKEND_URL for frontend API routes
3. **Payment Validation**: Test payment flows in staging environment
4. **Monitoring**: Set up logging for payment transactions
5. **Backup**: Ensure transaction data is backed up regularly

## Future Enhancements

1. **Multiple Payment Methods**: Support for credit cards, mobile money
2. **Payment Plans**: Installment payment options
3. **Insurance Integration**: Automatic insurance claim processing
4. **Payment Analytics**: Detailed payment reporting and analytics
5. **Automated Reconciliation**: Daily payment reconciliation reports 
 
 
 