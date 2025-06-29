const express = require("express")
const cors = require("cors")
const helmet = require("helmet")
const morgan = require("morgan")
const path = require("path")

// Import middleware
const errorHandler = require("./middleware/errorHandler")
const logger = require("./middleware/logger")

// Import routes
const authRoutes = require("./routes/auth")
const clinicRoutes = require("./routes/clinics")
const doctorRoutes = require("./routes/doctors")
const patientRoutes = require("./routes/patients")
const appointmentRoutes = require("./routes/appointments")
const prescriptionRoutes = require("./routes/prescriptions")
const recordRoutes = require("./routes/records")
const labRoutes = require("./routes/labs")
const nurseRoutes = require("./routes/nurses")
const userRoutes = require("./routes/users")
const availabilityRoutes = require("./routes/availability")
const telemedicineRoutes = require("./routes/telemedicine")
const analyticsRoutes = require("./routes/analytics")
const dashboardRoutes = require("./routes/dashboard")
const healthRoutes = require("./routes/health")
const searchRoutes = require("./routes/search")
const feedbackRoutes = require("./routes/feedback")
const notificationRoutes = require("./routes/notifications")
const specialtyRoutes = require("./routes/specialties")
const doctorsPublicRoutes = require("./routes/doctors-public")
const medicationRoutes = require("./routes/medications")
const diseaseRoutes = require("./routes/diseases")
const subscriptionRoutes = require('./routes/subscription')
const patientBalanceRoutes = require('./routes/patientBalance')
const staffSalaryRoutes = require('./routes/staffSalary')
const paymentRoutes = require('./routes/payments')

const app = express()

// Security middleware
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
  }),
)

// CORS configuration - UPDATED to include your Vercel deployment
const allowedOrigins = [
  "http://localhost:3000",
  "https://localhost:3000",
  "https://sehhapro-1.vercel.app", // Your Vercel deployment
  "https://sehhapro.vercel.app", // In case you have a custom domain
  "https://sehhapromvp.vercel.app", // Current Vercel deployment
  "https://sehhapro-frontend.vercel.app", // Another possible domain
  "https://*.vercel.app", // Allow all Vercel subdomains
  process.env.FRONTEND_URL,
  process.env.NEXT_PUBLIC_APP_URL,
].filter(Boolean)

console.log("🌐 Allowed CORS origins:", allowedOrigins)

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true)

      // Allow all Vercel domains for now
      if (origin.includes('vercel.app')) {
        return callback(null, true)
      }

      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true)
      } else {
        console.log(`CORS blocked origin: ${origin}`)
        callback(new Error("Not allowed by CORS"))
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Requested-With",
      "Accept",
      "Origin",
      "Access-Control-Request-Method",
      "Access-Control-Request-Headers",
    ],
    exposedHeaders: ["Authorization"],
    preflightContinue: false,
    optionsSuccessStatus: 204,
  }),
)

// Handle preflight requests explicitly
app.options("*", cors())

// Body parsing middleware
app.use(express.json({ limit: "10mb" }))
app.use(express.urlencoded({ extended: true, limit: "10mb" }))

// Logging middleware
app.use(morgan("combined", { stream: { write: (message) => logger.info(message.trim()) } }))

// Routes without rate limiting
app.use("/api/health", healthRoutes)
app.use("/api/doctors-public", doctorsPublicRoutes)
app.use("/api/auth", authRoutes)
app.use("/api/dashboard", dashboardRoutes)
app.use("/api/clinics", clinicRoutes)
app.use("/api/doctors", doctorRoutes)
app.use("/api/patients", patientRoutes)
app.use("/api/appointments", appointmentRoutes)
app.use("/api/prescriptions", prescriptionRoutes)
app.use("/api/records", recordRoutes)
app.use("/api/labs", labRoutes)
app.use("/api/nurses", nurseRoutes)
app.use("/api/users", userRoutes)
app.use("/api/availability", availabilityRoutes)
app.use("/api/telemedicine", telemedicineRoutes)
app.use("/api/analytics", analyticsRoutes)
app.use("/api/search", searchRoutes)
app.use("/api/feedback", feedbackRoutes)
app.use("/api/notifications", notificationRoutes)
app.use("/api/specialties", specialtyRoutes)
app.use("/api/medications", medicationRoutes)
app.use("/api/diseases", diseaseRoutes)
app.use('/api/subscription', subscriptionRoutes)
app.use('/api/patientBalance', patientBalanceRoutes)
app.use('/api/staff-salary', staffSalaryRoutes)
app.use('/api/payments', paymentRoutes)

// Serve static files
app.use("/uploads", express.static(path.join(__dirname, "uploads")))

// Health check endpoint
app.get("/", (req, res) => {
  res.json({
    message: "Healthcare Platform API",
    status: "running",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  })
})

// 404 handler
app.use("*", (req, res) => {
  res.status(404).json({
    error: "Route not found",
    path: req.originalUrl,
    method: req.method,
  })
})

// Global error handler
app.use(errorHandler)

module.exports = app