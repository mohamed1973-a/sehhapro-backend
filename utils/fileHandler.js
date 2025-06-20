/**
 * File handling utilities
 * Configured for secure file uploads with PostgreSQL storage references
 */
const multer = require("multer")
const path = require("path")
const fs = require("fs")
const crypto = require("crypto")

// Create uploads directory structure if it doesn't exist
const uploadsDir = path.join(__dirname, "..", "uploads")
const labsDir = path.join(uploadsDir, "labs")
const prescriptionsDir = path.join(uploadsDir, "prescriptions")
const dirs = [uploadsDir, labsDir, prescriptionsDir]

for (const dir of dirs) {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
  } catch (error) {
    console.error(`Error creating directory ${dir}:`, error)
  }
}

// Log successful directory creation
console.log("File upload directories initialized:")
console.log(`- Main uploads: ${uploadsDir}`)
console.log(`- Labs: ${labsDir}`)
console.log(`- Prescriptions: ${prescriptionsDir}`)

// Configure storage with secure filename generation
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Determine appropriate directory based on file type
    let uploadDir = uploadsDir

    if (file.fieldname.includes("lab")) {
      uploadDir = labsDir
    } else if (file.fieldname.includes("prescription")) {
      uploadDir = prescriptionsDir
    }

    cb(null, uploadDir)
  },
  filename: (req, file, cb) => {
    // Generate secure random filename to prevent path traversal attacks
    const randomName = crypto.randomBytes(16).toString("hex")
    const safeOriginalName = path.basename(file.originalname).replace(/[^a-zA-Z0-9.]/g, "_")
    const extension = path.extname(safeOriginalName)

    // Create filename with timestamp, random string and original extension
    const filename = `${Date.now()}-${randomName}${extension}`
    cb(null, filename)
  },
})

// Enhanced file filter with better security and MIME type checking
const fileFilter = (req, file, cb) => {
  // Define allowed MIME types
  const allowedMimeTypes = [
    // Images
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    // Documents
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    // Text
    "text/plain",
    // CSV
    "text/csv",
  ]

  // Check file size before processing (additional check beyond multer limits)
  if (Number.parseInt(req.headers["content-length"]) > 5 * 1024 * 1024) {
    return cb(new Error("File too large, maximum size is 5MB"), false)
  }

  // Validate MIME type
  if (allowedMimeTypes.includes(file.mimetype)) {
    // Additional validation for file extension
    const fileExtension = path.extname(file.originalname).toLowerCase()
    const validExtensions = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".pdf", ".doc", ".docx", ".txt", ".csv"]

    if (!validExtensions.includes(fileExtension)) {
      return cb(new Error(`Invalid file extension: ${fileExtension}`), false)
    }

    cb(null, true)
  } else {
    cb(new Error(`Unsupported file type: ${file.mimetype}`), false)
  }
}

// Configure multer with size limits and error handling
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
    files: 5, // Maximum 5 files per request
  },
})

/**
 * Get file URL for database storage
 * @param {Object} file - Multer file object
 * @returns {String} URL path to the file
 */
const getFileUrl = (file) => {
  if (!file) return null

  // Determine the appropriate subdirectory
  let subdir = ""
  if (file.destination.includes("labs")) {
    subdir = "labs"
  } else if (file.destination.includes("prescriptions")) {
    subdir = "prescriptions"
  }

  return `/uploads/${subdir ? subdir + "/" : ""}${file.filename}`
}

/**
 * Delete a file from the uploads directory
 * @param {String} filePath - Path to the file (from database)
 * @returns {Promise<Boolean>} Success status
 */
const deleteFile = async (filePath) => {
  if (!filePath) return false

  try {
    const fullPath = path.join(__dirname, "..", filePath)

    // Check if file exists
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath)
      return true
    }
    return false
  } catch (error) {
    console.error(`Error deleting file ${filePath}:`, error)
    return false
  }
}

module.exports = {
  upload,
  getFileUrl,
  deleteFile,
}
