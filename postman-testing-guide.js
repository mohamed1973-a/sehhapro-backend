/**
 * Healthcare Platform API Testing Guide
 *
 * This file contains a structured guide for testing all API endpoints
 * using Postman. Follow the steps in order to properly test the system.
 */

// ENVIRONMENT SETUP
/**
 * Create a Postman environment with these variables:
 *
 * | Variable            | Initial Value                |
 * |---------------------|------------------------------|
 * | baseUrl             | http://localhost:5300        |
 * | adminToken          | (empty)                      |
 * | doctorToken         | (empty)                      |
 * | patientToken        | (empty)                      |
 * | labToken            | (empty)                      |
 * | nurseToken          | (empty)                      |
 * | adminRefreshToken   | (empty)                      |
 * | doctorRefreshToken  | (empty)                      |
 * | patientRefreshToken | (empty)                      |
 * | labRefreshToken     | (empty)                      |
 * | nurseRefreshToken   | (empty)                      |
 * | clinicId            | (empty)                      |
 * | childClinicId       | (empty)                      |
 * | labClinicId         | (empty)                      |
 * | doctorId            | (empty)                      |
 * | patientId           | (empty)                      |
 * | labId               | (empty)                      |
 * | nurseId             | (empty)                      |
 * | appointmentId       | (empty)                      |
 * | prescriptionId      | (empty)                      |
 * | labRequestId        | (empty)                      |
 * | notificationId      | (empty)                      |
 * | telemedicineId      | (empty)                      |
 * | slotId              | (empty)                      |
 * | recordId            | (empty)                      |
 * | feedbackId          | (empty)                      |
 */

// TEST DATA
/**
 * Use this test data for your requests:
 *
 * {
 *   "admin": {
 *     "email": "admin@example.com",
 *     "password": "password123",
 *     "full_name": "Admin User"
 *   },
 *   "doctor": {
 *     "email": "doctor@example.com",
 *     "password": "password123",
 *     "full_name": "Dr. Jane Smith",
 *     "specialty": "Cardiology"
 *   },
 *   "nurse": {
 *     "email": "nurse@example.com",
 *     "password": "password123",
 *     "full_name": "Nurse Nancy",
 *     "specialty": "General Care"
 *   },
 *   "patient": {
 *     "email": "patient@example.com",
 *     "password": "password123",
 *     "full_name": "John Doe",
 *     "phone": "555-123-4567"
 *   },
 *   "lab": {
 *     "email": "lab@example.com",
 *     "password": "password123",
 *     "full_name": "Lab Technician"
 *   },
 *   "clinic": {
 *     "name": "Main Medical Center",
 *     "address": "123 Health Street",
 *     "phone": "555-987-6543",
 *     "email": "info@mainmedical.com",
 *     "description": "Primary care and specialty services",
 *     "type": "main"
 *   },
 *   "labClinic": {
 *     "name": "Diagnostic Lab Center",
 *     "address": "456 Science Blvd",
 *     "phone": "555-444-3333",
 *     "email": "labs@mainmedical.com",
 *     "description": "Comprehensive diagnostic services",
 *     "type": "lab"
 *   }
 * }
 */

// AUTHENTICATION TESTS

/**
 * 1. Register Admin (if not already created)
 *
 * Method: POST
 * URL: {{baseUrl}}/api/auth/register
 * Body:
 * {
 *   "full_name": "Admin User",
 *   "email": "admin@example.com",
 *   "password": "password123",
 *   "role": "platform_admin"
 * }
 *
 * Expected Status: 201 or 400 (if already exists)
 * Tests:
 * - If 201, save admin ID
 * - If 400, proceed to login
 */

/**
 * 2. Login Admin
 *
 * Method: POST
 * URL: {{baseUrl}}/api/auth/login
 * Body:
 * {
 *   "email": "admin@example.com",
 *   "password": "password123"
 * }
 *
 * Expected Status: 200
 * Tests:
 * - Save token to adminToken
 * - Save refresh token to adminRefreshToken
 */

/**
 * 3. Create Main Clinic
 *
 * Method: POST
 * URL: {{baseUrl}}/api/clinics
 * Headers: Authorization: Bearer {{adminToken}}
 * Body:
 * {
 *   "name": "Main Medical Center",
 *   "address": "123 Health Street",
 *   "phone": "555-987-6543",
 *   "email": "info@mainmedical.com",
 *   "description": "Primary care and specialty services",
 *   "type": "main"
 * }
 *
 * Expected Status: 201
 * Tests:
 * - Save clinic ID to clinicId
 */

/**
 * 4. Create Lab Clinic
 *
 * Method: POST
 * URL: {{baseUrl}}/api/clinics
 * Headers: Authorization: Bearer {{adminToken}}
 * Body:
 * {
 *   "name": "Diagnostic Lab Center",
 *   "address": "456 Science Blvd",
 *   "phone": "555-444-3333",
 *   "email": "labs@mainmedical.com",
 *   "description": "Comprehensive diagnostic services",
 *   "type": "lab",
 *   "parentId": "{{clinicId}}"
 * }
 *
 * Expected Status: 201
 * Tests:
 * - Save lab clinic ID to labClinicId
 */

/**
 * 5. Register Doctor
 *
 * Method: POST
 * URL: {{baseUrl}}/api/auth/register
 * Headers: Authorization: Bearer {{adminToken}}
 * Body:
 * {
 *   "full_name": "Dr. Jane Smith",
 *   "email": "doctor@example.com",
 *   "password": "password123",
 *   "role": "doctor",
 *   "clinicId": "{{clinicId}}",
 *   "phone": "555-111-2222"
 * }
 *
 * Expected Status: 201
 * Tests:
 * - Save doctor ID to doctorId
 * - Save doctor token to doctorToken
 * - Save doctor refresh token to doctorRefreshToken
 */

/**
 * 6. Register Nurse
 *
 * Method: POST
 * URL: {{baseUrl}}/api/auth/register
 * Headers: Authorization: Bearer {{adminToken}}
 * Body:
 * {
 *   "full_name": "Nurse Nancy",
 *   "email": "nurse@example.com",
 *   "password": "password123",
 *   "role": "nurse",
 *   "clinicId": "{{clinicId}}",
 *   "phone": "555-222-3333"
 * }
 *
 * Expected Status: 201
 * Tests:
 * - Save nurse ID to nurseId
 * - Save nurse token to nurseToken
 * - Save nurse refresh token to nurseRefreshToken
 */

/**
 * 7. Register Patient
 *
 * Method: POST
 * URL: {{baseUrl}}/api/auth/register
 * Body:
 * {
 *   "full_name": "John Doe",
 *   "email": "patient@example.com",
 *   "password": "password123",
 *   "role": "patient",
 *   "clinicId": "{{clinicId}}",
 *   "phone": "555-123-4567"
 * }
 *
 * Expected Status: 201
 * Tests:
 * - Save patient ID to patientId
 * - Save patient token to patientToken
 * - Save patient refresh token to patientRefreshToken
 */

/**
 * 8. Register Lab Technician
 *
 * Method: POST
 * URL: {{baseUrl}}/api/auth/register
 * Headers: Authorization: Bearer {{adminToken}}
 * Body:
 * {
 *   "full_name": "Lab Technician",
 *   "email": "lab@example.com",
 *   "password": "password123",
 *   "role": "lab",
 *   "clinicId": "{{labClinicId}}",
 *   "phone": "555-333-4444"
 * }
 *
 * Expected Status: 201
 * Tests:
 * - Save lab ID to labId
 * - Save lab token to labToken
 * - Save lab refresh token to labRefreshToken
 */

/**
 * 9. Refresh Admin Token
 *
 * Method: POST
 * URL: {{baseUrl}}/api/auth/refresh-token
 * Body:
 * {
 *   "refreshToken": "{{adminRefreshToken}}"
 * }
 *
 * Expected Status: 200
 * Tests:
 * - Update adminToken with new token
 * - Update adminRefreshToken with new refresh token
 */

/**
 * 10. Logout Admin
 *
 * Method: POST
 * URL: {{baseUrl}}/api/auth/logout
 * Body:
 * {
 *   "refreshToken": "{{adminRefreshToken}}"
 * }
 *
 * Expected Status: 200
 * Tests:
 * - Verify message indicates successful logout
 */

/**
 * 11. Login Admin Again
 *
 * Method: POST
 * URL: {{baseUrl}}/api/auth/login
 * Body:
 * {
 *   "email": "admin@example.com",
 *   "password": "password123"
 * }
 *
 * Expected Status: 200
 * Tests:
 * - Save token to adminToken
 * - Save refresh token to adminRefreshToken
 */

// CLINIC MANAGEMENT TESTS

/**
 * 12. Get All Clinics
 *
 * Method: GET
 * URL: {{baseUrl}}/api/clinics
 * Headers: Authorization: Bearer {{adminToken}}
 * Expected Status: 200
 * Tests:
 * - Verify response contains clinic data
 * - Verify clinic created earlier is in the list
 */

/**
 * 13. Get Specific Clinic
 *
 * Method: GET
 * URL: {{baseUrl}}/api/clinics/{{clinicId}}
 * Headers: Authorization: Bearer {{adminToken}}
 * Expected Status: 200
 * Tests:
 * - Verify clinic details match what was created
 */

/**
 * 14. Update Clinic
 *
 * Method: PUT
 * URL: {{baseUrl}}/api/clinics/{{clinicId}}
 * Headers: Authorization: Bearer {{adminToken}}
 * Body:
 * {
 *   "description": "Updated description with expanded services",
 *   "phone": "555-987-6543"
 * }
 *
 * Expected Status: 200
 * Tests:
 * - Verify description was updated
 */

/**
 * 15. Create Child Clinic
 *
 * Method: POST
 * URL: {{baseUrl}}/api/clinics
 * Headers: Authorization: Bearer {{adminToken}}
 * Body:
 * {
 *   "name": "Branch Clinic",
 *   "address": "456 Health Avenue",
 *   "phone": "555-111-2222",
 *   "email": "branch@mainmedical.com",
 *   "description": "Satellite location",
 *   "type": "child",
 *   "parentId": "{{clinicId}}"
 * }
 *
 * Expected Status: 201
 * Tests:
 * - Save child clinic ID to childClinicId
 */

/**
 * 16. Add Doctor to Clinic
 *
 * Method: POST
 * URL: {{baseUrl}}/api/clinics/{{childClinicId}}/doctors
 * Headers: Authorization: Bearer {{adminToken}}
 * Body:
 * {
 *   "doctorId": "{{doctorId}}"
 * }
 *
 * Expected Status: 201
 * Tests:
 * - Verify doctor was added to clinic
 */

/**
 * 17. Add Nurse to Clinic
 *
 * Method: POST
 * URL: {{baseUrl}}/api/clinics/{{childClinicId}}/nurses
 * Headers: Authorization: Bearer {{adminToken}}
 * Body:
 * {
 *   "nurseId": "{{nurseId}}"
 * }
 *
 * Expected Status: 201
 * Tests:
 * - Verify nurse was added to clinic
 */

// USER MANAGEMENT TESTS

/**
 * 18. Get Doctor Profile
 *
 * Method: GET
 * URL: {{baseUrl}}/api/users/profile
 * Headers: Authorization: Bearer {{doctorToken}}
 * Expected Status: 200
 * Tests:
 * - Verify doctor profile information
 */

/**
 * 19. Update Doctor Profile
 *
 * Method: PUT
 * URL: {{baseUrl}}/api/users/profile
 * Headers: Authorization: Bearer {{doctorToken}}
 * Body:
 * {
 *   "phone": "555-999-8888"
 * }
 *
 * Expected Status: 200
 * Tests:
 * - Verify phone number was updated
 */

/**
 * 20. Update Doctor Portfolio
 *
 * Method: PUT
 * URL: {{baseUrl}}/api/doctors/{{doctorId}}/portfolio
 * Headers: Authorization: Bearer {{doctorToken}}
 * Body:
 * {
 *   "specialty": "Cardiology",
 *   "subSpecialization": "Interventional Cardiology",
 *   "yearsExperience": 10,
 *   "education": [
 *     {
 *       "degree": "MD",
 *       "institution": "Harvard Medical School",
 *       "year": 2010
 *     }
 *   ],
 *   "languages": ["English", "Spanish"],
 *   "bio": "Experienced cardiologist specializing in heart health",
 *   "availableForTelemedicine": true,
 *   "consultationFee": 150,
 *   "licenseNumber": "MED12345"
 * }
 *
 * Expected Status: 200
 * Tests:
 * - Verify portfolio was updated with specialty and other details
 */

/**
 * 21. Update Nurse Portfolio
 *
 * Method: PUT
 * URL: {{baseUrl}}/api/nurses/{{nurseId}}/portfolio
 * Headers: Authorization: Bearer {{nurseToken}}
 * Body:
 * {
 *   "specialty": "General Care",
 *   "yearsExperience": 5,
 *   "education": [
 *     {
 *       "degree": "BSN",
 *       "institution": "University of Nursing",
 *       "year": 2015
 *     }
 *   ],
 *   "languages": ["English", "French"],
 *   "bio": "Dedicated nurse with experience in general patient care",
 *   "licenseNumber": "RN54321"
 * }
 *
 * Expected Status: 200
 * Tests:
 * - Verify portfolio was updated with specialty and other details
 */

/**
 * 22. Get All Doctors (Admin)
 *
 * Method: GET
 * URL: {{baseUrl}}/api/doctors
 * Headers: Authorization: Bearer {{adminToken}}
 * Expected Status: 200
 * Tests:
 * - Verify list contains the doctor we created
 */

/**
 * 23. Get All Nurses (Admin)
 *
 * Method: GET
 * URL: {{baseUrl}}/api/nurses
 * Headers: Authorization: Bearer {{adminToken}}
 * Expected Status: 200
 * Tests:
 * - Verify list contains the nurse we created
 */

/**
 * 24. Get Patient Profile
 *
 * Method: GET
 * URL: {{baseUrl}}/api/users/profile
 * Headers: Authorization: Bearer {{patientToken}}
 * Expected Status: 200
 * Tests:
 * - Verify patient profile information
 */

/**
 * 25. Update Patient Medical Profile
 *
 * Method: PUT
 * URL: {{baseUrl}}/api/patients/{{patientId}}/medical-profile
 * Headers: Authorization: Bearer {{patientToken}}
 * Body:
 * {
 *   "allergies": ["Penicillin", "Peanuts"],
 *   "medicalHistory": [
 *     {
 *       "condition": "Asthma",
 *       "diagnosedYear": 2015,
 *       "notes": "Mild, controlled with inhaler"
 *     }
 *   ],
 *   "medications": [
 *     {
 *       "name": "Albuterol",
 *       "dosage": "90mcg",
 *       "frequency": "As needed"
 *     }
 *   ]
 * }
 *
 * Expected Status: 200
 * Tests:
 * - Verify medical profile was updated
 */

/**
 * 26. Get Patient Medical Profile
 *
 * Method: GET
 * URL: {{baseUrl}}/api/patients/{{patientId}}/medical-profile
 * Headers: Authorization: Bearer {{doctorToken}}
 * Expected Status: 200
 * Tests:
 * - Verify medical profile contains allergies and medications
 */

/**
 * 27. Get All Patients (Admin)
 *
 * Method: GET
 * URL: {{baseUrl}}/api/patients
 * Headers: Authorization: Bearer {{adminToken}}
 * Expected Status: 200
 * Tests:
 * - Verify list contains the patient we created
 */

// AVAILABILITY AND APPOINTMENT TESTS

/**
 * 28. Create Doctor Availability Slot
 *
 * Method: POST
 * URL: {{baseUrl}}/api/availability
 * Headers: Authorization: Bearer {{doctorToken}}
 * Body:
 * {
 *   "clinicId": "{{clinicId}}",
 *   "startTime": "2025-01-15T09:00:00Z",
 *   "endTime": "2025-01-15T10:00:00Z",
 *   "providerType": "doctor"
 * }
 *
 * Expected Status: 201
 * Tests:
 * - Save slot ID to slotId
 */

/**
 * 29. Create Nurse Availability Slot
 *
 * Method: POST
 * URL: {{baseUrl}}/api/availability
 * Headers: Authorization: Bearer {{nurseToken}}
 * Body:
 * {
 *   "clinicId": "{{clinicId}}",
 *   "startTime": "2025-01-15T09:00:00Z",
 *   "endTime": "2025-01-15T10:00:00Z",
 *   "providerType": "nurse"
 * }
 *
 * Expected Status: 201
 * Tests:
 * - Verify slot was created
 */

/**
 * 30. Create Lab Availability Slot
 *
 * Method: POST
 * URL: {{baseUrl}}/api/availability
 * Headers: Authorization: Bearer {{labToken}}
 * Body:
 * {
 *   "clinicId": "{{labClinicId}}",
 *   "startTime": "2025-01-15T09:00:00Z",
 *   "endTime": "2025-01-15T10:00:00Z",
 *   "providerType": "lab"
 * }
 *
 * Expected Status: 201
 * Tests:
 * - Verify slot was created
 */

/**
 * 31. Get Doctor Availability Slots
 *
 * Method: GET
 * URL: {{baseUrl}}/api/availability?providerId={{doctorId}}&providerType=doctor
 * Headers: Authorization: Bearer {{patientToken}}
 * Expected Status: 200
 * Tests:
 * - Verify slots include the one we created
 */

/**
 * 32. Create Appointment
 *
 * Method: POST
 * URL: {{baseUrl}}/api/appointments
 * Headers: Authorization: Bearer {{patientToken}}
 * Body:
 * {
 *   "doctorId": "{{doctorId}}",
 *   "clinicId": "{{clinicId}}",
 *   "date": "2025-01-15T09:00:00Z",
 *   "type": "in-person",
 *   "reason": "Annual checkup"
 * }
 *
 * Expected Status: 201
 * Tests:
 * - Save appointment ID to appointmentId
 */

/**
 * 33. Get Patient Appointments
 *
 * Method: GET
 * URL: {{baseUrl}}/api/appointments
 * Headers: Authorization: Bearer {{patientToken}}
 * Expected Status: 200
 * Tests:
 * - Verify appointments include the one we created
 */

/**
 * 34. Get Doctor Appointments
 *
 * Method: GET
 * URL: {{baseUrl}}/api/appointments
 * Headers: Authorization: Bearer {{doctorToken}}
 * Expected Status: 200
 * Tests:
 * - Verify appointments include the one we created
 */

/**
 * 35. Update Appointment Status
 *
 * Method: PUT
 * URL: {{baseUrl}}/api/appointments/{{appointmentId}}
 * Headers: Authorization: Bearer {{doctorToken}}
 * Body:
 * {
 *   "status": "in-progress"
 * }
 *
 * Expected Status: 200
 * Tests:
 * - Verify status was updated to "in-progress"
 */

/**
 * 36. Complete Appointment
 *
 * Method: PUT
 * URL: {{baseUrl}}/api/appointments/{{appointmentId}}
 * Headers: Authorization: Bearer {{doctorToken}}
 * Body:
 * {
 *   "status": "completed"
 * }
 *
 * Expected Status: 200
 * Tests:
 * - Verify status was updated to "completed"
 */

// MEDICAL RECORDS TESTS

/**
 * 37. Create Medical Record
 *
 * Method: POST
 * URL: {{baseUrl}}/api/records
 * Headers: Authorization: Bearer {{doctorToken}}
 * Body:
 * {
 *   "patientId": "{{patientId}}",
 *   "diagnosis": "Seasonal allergies",
 *   "treatment": "Antihistamines",
 *   "notes": "Patient should avoid outdoor activities during high pollen count",
 *   "appointmentId": "{{appointmentId}}"
 * }
 *
 * Expected Status: 201
 * Tests:
 * - Save record ID to recordId
 */

/**
 * 38. Get Patient Records (Doctor View)
 *
 * Method: GET
 * URL: {{baseUrl}}/api/records/patient/{{patientId}}
 * Headers: Authorization: Bearer {{doctorToken}}
 * Expected Status: 200
 * Tests:
 * - Verify records include the one we created
 */

/**
 * 39. Get Patient Records (Patient View)
 *
 * Method: GET
 * URL: {{baseUrl}}/api/records
 * Headers: Authorization: Bearer {{patientToken}}
 * Expected Status: 200
 * Tests:
 * - Verify records include the one we created
 */

/**
 * 40. Update Medical Record
 *
 * Method: PUT
 * URL: {{baseUrl}}/api/records/{{recordId}}
 * Headers: Authorization: Bearer {{doctorToken}}
 * Body:
 * {
 *   "diagnosis": "Seasonal allergies and mild asthma",
 *   "treatment": "Antihistamines and inhaler as needed"
 * }
 *
 * Expected Status: 200
 * Tests:
 * - Verify diagnosis and treatment were updated
 */

// PRESCRIPTION TESTS

/**
 * 41. Create Prescription
 *
 * Method: POST
 * URL: {{baseUrl}}/api/prescriptions
 * Headers: Authorization: Bearer {{doctorToken}}
 * Body:
 * {
 *   "patientId": "{{patientId}}",
 *   "medications": [
 *     {
 *       "name": "Loratadine",
 *       "dosage": "10mg",
 *       "frequency": "Once daily",
 *       "duration": "30 days"
 *     },
 *     {
 *       "name": "Fluticasone",
 *       "dosage": "50mcg",
 *       "frequency": "Twice daily",
 *       "duration": "30 days"
 *     }
 *   ],
 *   "refills": 2,
 *   "notes": "Take with food",
 *   "clinicId": "{{clinicId}}"
 * }
 *
 * Expected Status: 201
 * Tests:
 * - Save prescription ID to prescriptionId
 */

/**
 * 42. Get Patient Prescriptions
 *
 * Method: GET
 * URL: {{baseUrl}}/api/prescriptions
 * Headers: Authorization: Bearer {{patientToken}}
 * Expected Status: 200
 * Tests:
 * - Verify prescriptions include the one we created
 */

/**
 * 43. Get Doctor Prescriptions
 *
 * Method: GET
 * URL: {{baseUrl}}/api/prescriptions
 * Headers: Authorization: Bearer {{doctorToken}}
 * Expected Status: 200
 * Tests:
 * - Verify prescriptions include the one we created
 */

/**
 * 44. Update Prescription
 *
 * Method: PUT
 * URL: {{baseUrl}}/api/prescriptions/{{prescriptionId}}
 * Headers: Authorization: Bearer {{doctorToken}}
 * Body:
 * {
 *   "medications": [
 *     {
 *       "name": "Loratadine",
 *       "dosage": "10mg",
 *       "frequency": "Once daily",
 *       "duration": "60 days"
 *     },
 *     {
 *       "name": "Fluticasone",
 *       "dosage": "50mcg",
 *       "frequency": "Twice daily",
 *       "duration": "60 days"
 *     }
 *   ],
 *   "refills": 3
 * }
 *
 * Expected Status: 200
 * Tests:
 * - Verify medications and refills were updated
 */

/**
 * 45. Print Prescription
 *
 * Method: POST
 * URL: {{baseUrl}}/api/prescriptions/{{prescriptionId}}/print
 * Headers: Authorization: Bearer {{doctorToken}}
 * Expected Status: 200
 * Tests:
 * - Verify PDF file is returned
 */

// LAB REQUEST TESTS

/**
 * 46. Create Lab Request
 *
 * Method: POST
 * URL: {{baseUrl}}/api/labs
 * Headers: Authorization: Bearer {{doctorToken}}
 * Body:
 * {
 *   "patientId": "{{patientId}}",
 *   "testType": "Blood Panel",
 *   "labClinicId": "{{labClinicId}}",
 *   "notes": "Check cholesterol levels"
 * }
 *
 * Expected Status: 201
 * Tests:
 * - Save lab request ID to labRequestId
 */

/**
 * 47. Get Patient Lab Requests
 *
 * Method: GET
 * URL: {{baseUrl}}/api/labs
 * Headers: Authorization: Bearer {{patientToken}}
 * Expected Status: 200
 * Tests:
 * - Verify lab requests include the one we created
 */

/**
 * 48. Get Lab Technician Lab Requests
 *
 * Method: GET
 * URL: {{baseUrl}}/api/labs
 * Headers: Authorization: Bearer {{labToken}}
 * Expected Status: 200
 * Tests:
 * - Verify lab requests include the one we created
 */

/**
 * 49. Update Lab Request Status (In Progress)
 *
 * Method: PUT
 * URL: {{baseUrl}}/api/labs/{{labRequestId}}
 * Headers: Authorization: Bearer {{labToken}}
 * Body:
 * {
 *   "status": "in-progress"
 * }
 *
 * Expected Status: 200
 * Tests:
 * - Verify status was updated to "in-progress"
 */

/**
 * 50. Update Lab Request with Results
 *
 * Method: PUT
 * URL: {{baseUrl}}/api/labs/{{labRequestId}}
 * Headers: Authorization: Bearer {{labToken}}
 * Body:
 * {
 *   "status": "completed",
 *   "resultNotes": "Cholesterol: 180 mg/dL (Normal range: <200)\nHDL: 55 mg/dL (Normal range: >40)\nLDL: 110 mg/dL (Normal range: <130)"
 * }
 *
 * Expected Status: 200
 * Tests:
 * - Verify status was updated to "completed"
 * - Verify result notes were added
 */

/**
 * 51. Get Specific Lab Request
 *
 * Method: GET
 * URL: {{baseUrl}}/api/labs/{{labRequestId}}
 * Headers: Authorization: Bearer {{doctorToken}}
 * Expected Status: 200
 * Tests:
 * - Verify lab request details match what was created and updated
 */

/**
 * 52. Print Lab Results
 *
 * Method: GET
 * URL: {{baseUrl}}/api/labs/{{labRequestId}}/print
 * Headers: Authorization: Bearer {{doctorToken}}
 * Expected Status: 200
 * Tests:
 * - Verify PDF file is returned
 */

// TELEMEDICINE TESTS

/**
 * 53. Create Doctor Availability for Telemedicine
 *
 * Method: POST
 * URL: {{baseUrl}}/api/availability
 * Headers: Authorization: Bearer {{doctorToken}}
 * Body:
 * {
 *   "clinicId": "{{clinicId}}",
 *   "startTime": "2025-01-20T14:00:00Z",
 *   "endTime": "2025-01-20T15:00:00Z",
 *   "providerType": "doctor"
 * }
 *
 * Expected Status: 201
 * Tests:
 * - Save telemedicine slot ID
 */

/**
 * 54. Schedule Telemedicine Session
 *
 * Method: POST
 * URL: {{baseUrl}}/api/telemedicine
 * Headers: Authorization: Bearer {{patientToken}}
 * Body:
 * {
 *   "specialty": "Cardiology",
 *   "date": "2025-01-20T14:00:00Z",
 *   "reason": "Follow-up consultation"
 * }
 *
 * Expected Status: 201
 * Tests:
 * - Save telemedicine session ID to telemedicineId
 */

/**
 * 55. Get Patient Telemedicine Sessions
 *
 * Method: GET
 * URL: {{baseUrl}}/api/telemedicine
 * Headers: Authorization: Bearer {{patientToken}}
 * Expected Status: 200
 * Tests:
 * - Verify sessions include the one we created
 */

/**
 * 56. Get Doctor Telemedicine Sessions
 *
 * Method: GET
 * URL: {{baseUrl}}/api/telemedicine
 * Headers: Authorization: Bearer {{doctorToken}}
 * Expected Status: 200
 * Tests:
 * - Verify sessions include the one we created
 */

/**
 * 57. Start Telemedicine Session
 *
 * Method: POST
 * URL: {{baseUrl}}/api/telemedicine/{{telemedicineId}}/start
 * Headers: Authorization: Bearer {{doctorToken}}
 * Expected Status: 200
 * Tests:
 * - Verify status changed to "in-progress"
 */

/**
 * 58. End Telemedicine Session
 *
 * Method: POST
 * URL: {{baseUrl}}/api/telemedicine/{{telemedicineId}}/end
 * Headers: Authorization: Bearer {{doctorToken}}
 * Body:
 * {
 *   "notes": "Patient's condition is improving. Continue current medications."
 * }
 *
 * Expected Status: 200
 * Tests:
 * - Verify status changed to "completed"
 * - Verify notes were added
 */

// NOTIFICATION TESTS

/**
 * 59. Get User Notifications
 *
 * Method: GET
 * URL: {{baseUrl}}/api/notifications
 * Headers: Authorization: Bearer {{patientToken}}
 * Expected Status: 200
 * Tests:
 * - Verify notifications exist (from appointments, prescriptions, etc.)
 * - Save a notification ID to notificationId
 */

/**
 * 60. Mark Notification as Read
 *
 * Method: PUT
 * URL: {{baseUrl}}/api/notifications/{{notificationId}}/read
 * Headers: Authorization: Bearer {{patientToken}}
 * Expected Status: 200
 * Tests:
 * - Verify notification was marked as read
 */

/**
 * 61. Create Custom Notification
 *
 * Method: POST
 * URL: {{baseUrl}}/api/notifications
 * Headers: Authorization: Bearer {{adminToken}}
 * Body:
 * {
 *   "userId": "{{patientId}}",
 *   "message": "Your annual wellness check is due next month",
 *   "type": "reminder",
 *   "priority": "normal"
 * }
 *
 * Expected Status: 201
 * Tests:
 * - Verify notification was created
 */

/**
 * 62. Delete Notification
 *
 * Method: DELETE
 * URL: {{baseUrl}}/api/notifications/{{notificationId}}
 * Headers: Authorization: Bearer {{patientToken}}
 * Expected Status: 200
 * Tests:
 * - Verify notification was deleted
 */

/**
 * 63. Update Notification Config
 *
 * Method: POST
 * URL: {{baseUrl}}/api/notifications/config
 * Headers: Authorization: Bearer {{adminToken}}
 * Body:
 * {
 *   "type": "appointment_reminder",
 *   "sms_enabled": true,
 *   "sms_template": "Reminder: You have an appointment on {date} at {time}"
 * }
 *
 * Expected Status: 200
 * Tests:
 * - Verify config was updated
 */

// FEEDBACK TESTS

/**
 * 64. Submit Feedback for Appointment
 *
 * Method: POST
 * URL: {{baseUrl}}/api/feedback/appointments/{{appointmentId}}
 * Headers: Authorization: Bearer {{patientToken}}
 * Body:
 * {
 *   "rating": 5,
 *   "comments": "Dr. Smith was very thorough and explained everything clearly."
 * }
 *
 * Expected Status: 201
 * Tests:
 * - Save feedback ID to feedbackId
 */

/**
 * 65. Get Doctor Feedback
 *
 * Method: GET
 * URL: {{baseUrl}}/api/feedback/doctors/{{doctorId}}
 * Headers: Authorization: Bearer {{patientToken}}
 * Expected Status: 200
 * Tests:
 * - Verify feedback includes the one we created
 * - Verify average rating is calculated correctly
 */

// SEARCH TESTS

/**
 * 66. Search Patients
 *
 * Method: GET
 * URL: {{baseUrl}}/api/search/patients?query=John
 * Headers: Authorization: Bearer {{doctorToken}}
 * Expected Status: 200
 * Tests:
 * - Verify results include the patient we created
 */

/**
 * 67. Search Doctors
 *
 * Method: GET
 * URL: {{baseUrl}}/api/search/doctors?specialty=Cardiology
 * Headers: Authorization: Bearer {{adminToken}}
 * Expected Status: 200
 * Tests:
 * - Verify results include the doctor we created
 */

/**
 * 68. Search Appointments
 *
 * Method: GET
 * URL: {{baseUrl}}/api/search/appointments?status=completed
 * Headers: Authorization: Bearer {{doctorToken}}
 * Expected Status: 200
 * Tests:
 * - Verify results include the appointment we created and completed
 */

// CLEANUP TESTS

/**
 * 69. Cancel Telemedicine Session
 *
 * Method: PUT
 * URL: {{baseUrl}}/api/telemedicine/{{telemedicineId}}
 * Headers: Authorization: Bearer {{adminToken}}
 * Body:
 * {
 *   "status": "cancelled"
 * }
 *
 * Expected Status: 200
 * Tests:
 * - Verify status changed to "cancelled"
 */

/**
 * 70. Delete Doctor (Admin)
 *
 * Method: DELETE
 * URL: {{baseUrl}}/api/doctors/{{doctorId}}
 * Headers: Authorization: Bearer {{adminToken}}
 * Expected Status: 200
 * Tests:
 * - Verify doctor was deleted
 */

/**
 * 71. Delete Nurse (Admin)
 *
 * Method: DELETE
 * URL: {{baseUrl}}/api/nurses/{{nurseId}}
 * Headers: Authorization: Bearer {{adminToken}}
 * Expected Status: 200
 * Tests:
 * - Verify nurse was deleted
 */

/**
 * 72. Delete Patient (Admin)
 *
 * Method: DELETE
 * URL: {{baseUrl}}/api/patients/{{patientId}}
 * Headers: Authorization: Bearer {{adminToken}}
 * Expected Status: 200
 * Tests:
 * - Verify patient was deleted
 */

/**
 * 73. Delete Lab Clinic (Admin)
 *
 * Method: DELETE
 * URL: {{baseUrl}}/api/clinics/{{labClinicId}}
 * Headers: Authorization: Bearer {{adminToken}}
 * Expected Status: 200
 * Tests:
 * - Verify lab clinic was deleted
 */

/**
 * 74. Delete Child Clinic (Admin)
 *
 * Method: DELETE
 * URL: {{baseUrl}}/api/clinics/{{childClinicId}}
 * Headers: Authorization: Bearer {{adminToken}}
 * Expected Status: 200
 * Tests:
 * - Verify child clinic was deleted
 */

/**
 * 75. Delete Main Clinic (Admin)
 *
 * Method: DELETE
 * URL: {{baseUrl}}/api/clinics/{{clinicId}}
 * Headers: Authorization: Bearer {{adminToken}}
 * Expected Status: 200 or 400 (if has child clinics)
 * Tests:
 * - If 400, verify error message about child clinics
 */

// HEALTH CHECK

/**
 * 76. System Health Check
 *
 * Method: GET
 * URL: {{baseUrl}}/health
 * Expected Status: 200
 * Tests:
 * - Verify system status is "ok"
 * - Verify database connection is "connected"
 */
