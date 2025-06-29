# Platform Reservation Payment System

## Overview

The platform reservation system ensures that payments are properly held by the platform/system until appointment completion, then transferred to the doctor. This provides security and proper money flow management.

## How It Works

### 1. **Booking Phase - Money Reservation**

When a patient books an appointment with balance payment:

```
Patient Balance: 5,000 DZD
Appointment Fee: 1,000 DZD
```

**Process:**
1. **Patient Transaction**: Money deducted from patient balance
   - Patient balance becomes: 4,000 DZD
   - Transaction status: `reserved`
   - Description: "Telemedicine appointment payment - Appointment #123 (RESERVED)"

2. **Platform Transaction**: Money held by platform
   - Platform user ID: 0 (represents system/platform)
   - Transaction status: `reserved`
   - Description: "Platform reservation for telemedicine appointment #123"

**Result:**
- Patient sees reduced balance (4,000 DZD)
- Money is held by platform (not yet with doctor)
- Doctor balance unchanged
- Appointment confirmed

### 2. **Completion Phase - Money Transfer**

When appointment is completed:

```
Reserved Amount: 1,000 DZD
Doctor Current Balance: 2,000 DZD
```

**Process:**
1. **Update Patient Transaction**: Mark as completed
   - Status changes from `reserved` to `completed`
   - Description updated: "... (RESERVED) - COMPLETED"

2. **Update Platform Transaction**: Mark as completed
   - Status changes from `reserved` to `completed`
   - Description updated: "... - TRANSFERRED TO DOCTOR"

3. **Doctor Balance Update**: Transfer money to doctor
   - Doctor balance becomes: 3,000 DZD

4. **Doctor Transaction**: Create income record
   - Type: `income`
   - Status: `completed`
   - Description: "Telemedicine appointment income - Appointment #123"

**Result:**
- Patient transaction completed
- Platform reservation released
- Doctor receives payment
- Doctor balance increased

## Database Schema

### Patient Transactions Table
```sql
-- Patient payment (money deducted)
INSERT INTO patient_transactions (
  patient_id, type, amount, description, 
  payment_method, status, related_appointment_id
) VALUES (
  1, 'payment', 1000, 
  'Telemedicine appointment payment - Appointment #123 (RESERVED)',
  'balance', 'reserved', 123
);

-- Platform reservation (money held by platform)
INSERT INTO patient_transactions (
  patient_id, type, amount, description, 
  payment_method, status, related_appointment_id
) VALUES (
  0, 'reservation', 1000, 
  'Platform reservation for telemedicine appointment #123',
  'platform', 'reserved', 123
);

-- Doctor income (upon completion)
INSERT INTO patient_transactions (
  patient_id, type, amount, description, 
  payment_method, status, related_appointment_id
) VALUES (
  2, 'income', 1000, 
  'Telemedicine appointment income - Appointment #123',
  'balance', 'completed', 123
);
```

## Transaction Status Flow

```
1. Booking: 
   - Patient transaction: status = 'reserved'
   - Platform transaction: status = 'reserved'

2. Completion:
   - Patient transaction: status = 'completed'
   - Platform transaction: status = 'completed'
   - Doctor transaction: status = 'completed'

3. Cancellation:
   - Patient transaction: status = 'failed'
   - Platform transaction: status = 'failed'
   - Refund transaction: status = 'completed'
```

## Benefits

### 1. **Security**
- Money is held by platform, not immediately with doctor
- Prevents fraud and ensures proper completion
- Platform acts as escrow service

### 2. **Proper Money Flow**
- Patient pays → Platform holds → Doctor receives
- Clear audit trail for all transactions
- No money lost in the process

### 3. **User Experience**
- Patient sees money deducted immediately (reserved)
- Doctor knows payment is guaranteed upon completion
- Platform ensures fair transaction

### 4. **Business Logic**
- Platform can take fees if needed
- Proper accounting for all parties
- Clear transaction history

## Error Handling

### 1. **Insufficient Balance**
```
Error: "Insufficient balance. Required: 1000 DZD, Available: 500 DZD"
Action: No transaction created, appointment not booked
```

### 2. **Appointment Cancellation**
```
Action: 
- Mark transactions as 'failed'
- Refund patient balance
- Create refund transaction record
```

### 3. **System Failure**
```
Action: 
- Rollback all transactions
- Restore patient balance
- Log error for investigation
```

## Frontend Implementation

### Payment Step Messaging
```tsx
{/* Telemedicine Payment Requirement */}
{isTelemedicine && (
  <div className="bg-orange-50 border border-orange-200 rounded-lg p-4">
    <div className="flex items-center space-x-2">
      <AlertCircle className="h-5 w-5 text-orange-600" />
      <div>
        <div className="font-medium text-orange-900">Telemedicine Payment</div>
        <div className="text-sm text-orange-700">
          Telemedicine appointments require balance payment. The amount will be reserved by the platform and transferred to the doctor upon session completion.
        </div>
      </div>
    </div>
  </div>
)}

{/* Payment Method Selection Feedback */}
{bookingData.paymentMethod === "balance" && isTelemedicine && (
  <div className="text-xs text-green-700 mt-1">
    The payment will be reserved by the platform and transferred to the doctor when the session is completed.
  </div>
)}
```

## Testing Scenarios

### 1. **Successful Telemedicine Booking**
```
1. Patient has sufficient balance
2. Book telemedicine appointment
3. Verify patient balance reduced
4. Verify platform reservation created
5. Complete appointment
6. Verify doctor balance increased
7. Verify all transactions completed
```

### 2. **Insufficient Balance**
```
1. Patient has insufficient balance
2. Try to book telemedicine appointment
3. Verify error message
4. Verify no transactions created
5. Verify patient balance unchanged
```

### 3. **Appointment Cancellation**
```
1. Book appointment with balance payment
2. Cancel appointment
3. Verify patient balance refunded
4. Verify transactions marked as failed
5. Verify refund transaction created
```

## Platform User ID

The platform is represented by user ID `0` in the system:
- Used for platform-held reservations
- Not a real user account
- Special handling in queries
- Used only for transaction tracking

## Conclusion

The platform reservation system provides a secure, transparent, and fair payment flow where:
- Patients pay upfront and see their balance reduced
- Platform holds the money securely
- Doctors receive payment only upon completion
- All transactions are properly tracked and auditable

This system ensures trust between all parties and provides a solid foundation for the healthcare platform's payment infrastructure. 