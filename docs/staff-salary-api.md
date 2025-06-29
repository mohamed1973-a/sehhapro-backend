# Staff Salary Management API Documentation

## Overview

The Staff Salary Management API provides endpoints for managing clinic staff salaries, payments, and adjustments. This system handles both staff with user accounts (doctors, nurses) and staff without accounts (agents, cleaners, etc.).

## Base URL

```
/api/staff-salary
```

## Authentication

All endpoints require authentication using JWT Bearer token:

```
Authorization: Bearer <your-jwt-token>
```

## Endpoints

### 1. Clinic Staff Management

#### Get All Clinic Staff
```http
GET /api/staff-salary/clinics/:clinicId/staff
```

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 10, max: 100)
- `search` (optional): Search by name or email
- `position` (optional): Filter by position
- `status` (optional): Filter by status

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "full_name": "John Doe",
      "phone": "+213 21 123 456",
      "email": "john.doe@clinic.dz",
      "position": "agent",
      "employment_type": "full_time",
      "monthly_salary": 45000.00,
      "status": "active",
      "start_date": "2024-01-01",
      "end_date": null,
      "notes": "Reception agent",
      "created_at": "2024-01-01T00:00:00Z",
      "staff_type": "clinic_staff",
      "user_id": null,
      "balance": null
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 1,
    "pages": 1
  },
  "message": "Found 1 staff members"
}
```

#### Create Clinic Staff Member
```http
POST /api/staff-salary/clinics/:clinicId/staff
```

**Request Body:**
```json
{
  "full_name": "Jane Smith",
  "phone": "+213 21 123 457",
  "email": "jane.smith@clinic.dz",
  "position": "cleaner",
  "employment_type": "full_time",
  "monthly_salary": 35000.00,
  "notes": "Cleaning staff"
}
```

**Required Fields:**
- `full_name`: Staff member's full name
- `position`: Job position
- `monthly_salary`: Monthly salary amount

**Optional Fields:**
- `phone`: Phone number
- `email`: Email address
- `employment_type`: "full_time", "part_time", "contract", "temporary"
- `notes`: Additional notes

#### Update Clinic Staff Member
```http
PUT /api/staff-salary/clinics/:clinicId/staff/:staffId
```

**Request Body:**
```json
{
  "monthly_salary": 50000.00,
  "status": "active",
  "notes": "Updated notes"
}
```

#### Delete Clinic Staff Member
```http
DELETE /api/staff-salary/clinics/:clinicId/staff/:staffId
```

### 2. Salary Payments Management

#### Get Salary Payments
```http
GET /api/staff-salary/clinics/:clinicId/payments
```

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 10, max: 100)
- `month` (optional): Filter by payment month (YYYY-MM-DD)
- `status` (optional): Filter by payment status
- `staffId` (optional): Filter by staff member ID

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "staff_id": 1,
      "clinic_id": 1,
      "payment_month": "2024-01-01",
      "base_salary": 45000.00,
      "net_salary": 42000.00,
      "payment_method": "bank_transfer",
      "payment_status": "paid",
      "payment_date": "2024-01-31",
      "reference_number": "PAY-001",
      "notes": "January salary",
      "created_at": "2024-01-31T00:00:00Z",
      "updated_at": "2024-01-31T00:00:00Z",
      "created_by": 1,
      "staff_name": "John Doe",
      "position": "agent",
      "processed_by_name": "Admin User"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 1,
    "pages": 1
  }
}
```

#### Create Salary Payment
```http
POST /api/staff-salary/clinics/:clinicId/payments
```

**Request Body:**
```json
{
  "staff_id": 1,
  "payment_month": "2024-01-01",
  "payment_method": "bank_transfer",
  "payment_date": "2024-01-31",
  "reference_number": "PAY-001",
  "notes": "January salary payment"
}
```

**Required Fields:**
- `staff_id`: Staff member ID
- `payment_month`: Payment month (YYYY-MM-DD)

**Optional Fields:**
- `payment_method`: "bank_transfer", "cash", "check", "mobile_money"
- `payment_date`: Actual payment date
- `reference_number`: Payment reference
- `notes`: Additional notes

#### Update Salary Payment
```http
PUT /api/staff-salary/clinics/:clinicId/payments/:paymentId
```

**Request Body:**
```json
{
  "payment_status": "paid",
  "payment_date": "2024-01-31",
  "reference_number": "PAY-001-UPDATED",
  "notes": "Payment completed"
}
```

### 3. Salary Adjustments Management

#### Get Salary Adjustments
```http
GET /api/staff-salary/clinics/:clinicId/adjustments
```

**Query Parameters:**
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 10, max: 100)
- `month` (optional): Filter by effective month (YYYY-MM-DD)
- `type` (optional): Filter by adjustment type
- `status` (optional): Filter by adjustment status
- `staffId` (optional): Filter by staff member ID

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "staff_id": 1,
      "clinic_id": 1,
      "adjustment_type": "bonus",
      "amount": 5000.00,
      "reason": "Performance bonus",
      "effective_month": "2024-01-01",
      "status": "applied",
      "created_at": "2024-01-15T00:00:00Z",
      "updated_at": "2024-01-15T00:00:00Z",
      "created_by": 1,
      "staff_name": "John Doe",
      "position": "agent",
      "created_by_name": "Admin User"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 1,
    "pages": 1
  }
}
```

#### Create Salary Adjustment
```http
POST /api/staff-salary/clinics/:clinicId/adjustments
```

**Request Body:**
```json
{
  "staff_id": 1,
  "adjustment_type": "bonus",
  "amount": 5000.00,
  "reason": "Performance bonus for excellent service",
  "effective_month": "2024-01-01",
  "status": "pending"
}
```

**Required Fields:**
- `staff_id`: Staff member ID
- `adjustment_type`: "bonus", "deduction", "overtime", "advance"
- `amount`: Adjustment amount
- `reason`: Reason for adjustment
- `effective_month`: Effective month (YYYY-MM-DD)

**Optional Fields:**
- `status`: "pending", "applied", "cancelled" (default: "pending")

#### Update Salary Adjustment Status
```http
PUT /api/staff-salary/clinics/:clinicId/adjustments/:adjustmentId
```

**Request Body:**
```json
{
  "status": "applied"
}
```

### 4. Salary Statistics

#### Get Salary Statistics
```http
GET /api/staff-salary/clinics/:clinicId/stats
```

**Query Parameters:**
- `month` (optional): Month for statistics (YYYY-MM-DD, default: current month)

**Response:**
```json
{
  "success": true,
  "data": {
    "totalStaff": 5,
    "currentMonth": "2024-01-01",
    "payments": {
      "total": 5,
      "totalAmount": 225000.00,
      "paidAmount": 200000.00,
      "pendingAmount": 25000.00
    },
    "adjustments": {
      "total": 3,
      "totalBonuses": 15000.00,
      "totalDeductions": 5000.00
    }
  },
  "message": "Salary statistics retrieved successfully"
}
```

## Error Responses

### 400 Bad Request
```json
{
  "success": false,
  "error": "Validation error",
  "details": "Full name is required"
}
```

### 401 Unauthorized
```json
{
  "success": false,
  "error": "Access token required"
}
```

### 403 Forbidden
```json
{
  "success": false,
  "error": "Access denied to this clinic"
}
```

### 404 Not Found
```json
{
  "success": false,
  "error": "Staff member not found"
}
```

### 500 Internal Server Error
```json
{
  "success": false,
  "error": "Server error",
  "details": "Database connection failed"
}
```

## Data Models

### Clinic Staff
```sql
CREATE TABLE clinic_staff (
  id SERIAL PRIMARY KEY,
  clinic_id INTEGER NOT NULL REFERENCES clinics(id),
  full_name VARCHAR(255) NOT NULL,
  phone VARCHAR(20),
  email VARCHAR(255),
  position VARCHAR(100) NOT NULL,
  employment_type VARCHAR(50) DEFAULT 'full_time',
  monthly_salary DECIMAL(10,2) NOT NULL,
  status VARCHAR(20) DEFAULT 'active',
  start_date DATE DEFAULT CURRENT_DATE,
  end_date DATE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### Staff Salary Payments
```sql
CREATE TABLE staff_salary_payments (
  id SERIAL PRIMARY KEY,
  staff_id INTEGER NOT NULL REFERENCES clinic_staff(id),
  clinic_id INTEGER NOT NULL REFERENCES clinics(id),
  payment_month DATE NOT NULL,
  base_salary DECIMAL(10,2) NOT NULL,
  net_salary DECIMAL(10,2) NOT NULL,
  payment_method VARCHAR(50) DEFAULT 'bank_transfer',
  payment_status VARCHAR(20) DEFAULT 'pending',
  payment_date DATE,
  reference_number VARCHAR(100),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by INTEGER REFERENCES users(id)
);
```

### Staff Salary Adjustments
```sql
CREATE TABLE staff_salary_adjustments (
  id SERIAL PRIMARY KEY,
  staff_id INTEGER NOT NULL REFERENCES clinic_staff(id),
  clinic_id INTEGER NOT NULL REFERENCES clinics(id),
  adjustment_type VARCHAR(50) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  reason TEXT NOT NULL,
  effective_month DATE NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by INTEGER REFERENCES users(id)
);
```

## Usage Examples

### JavaScript/Node.js
```javascript
const axios = require('axios');

// Get clinic staff
const getStaff = async (clinicId, token) => {
  const response = await axios.get(`/api/staff-salary/clinics/${clinicId}/staff`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return response.data;
};

// Create staff member
const createStaff = async (clinicId, staffData, token) => {
  const response = await axios.post(`/api/staff-salary/clinics/${clinicId}/staff`, staffData, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return response.data;
};

// Create salary payment
const createPayment = async (clinicId, paymentData, token) => {
  const response = await axios.post(`/api/staff-salary/clinics/${clinicId}/payments`, paymentData, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return response.data;
};
```

### cURL Examples
```bash
# Get clinic staff
curl -X GET "http://localhost:5000/api/staff-salary/clinics/1/staff" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Create staff member
curl -X POST "http://localhost:5000/api/staff-salary/clinics/1/staff" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "full_name": "John Doe",
    "position": "agent",
    "monthly_salary": 45000.00
  }'

# Create salary payment
curl -X POST "http://localhost:5000/api/staff-salary/clinics/1/payments" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "staff_id": 1,
    "payment_month": "2024-01-01"
  }'
```

## Notes

1. **Role-based Access**: Only platform admins and clinic admins can access these endpoints
2. **Clinic Isolation**: Clinic admins can only manage staff within their assigned clinics
3. **Automatic Calculations**: Net salary is automatically calculated using database functions
4. **Audit Trail**: All changes are logged with timestamps and user information
5. **Validation**: All inputs are validated using express-validator
6. **Pagination**: List endpoints support pagination for better performance
7. **Search & Filtering**: Most list endpoints support search and filtering options 
 
 
 