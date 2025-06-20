/**
 * Database utilities for common operations
 * Optimized for Neon Database and serverless environments
 */
const { pool } = require("../config/database")
const logger = require("../middleware/logger")

/**
 * Begin a database transaction with enhanced error handling for Neon
 */
const beginTransaction = async (req, res, next) => {
  let client
  try {
    // Add retry logic for Neon connection issues
    client = await retryConnection(3)
    await client.query("BEGIN")

    req.dbTransaction = {
      client,
      commit: async () => {
        try {
          await client.query("COMMIT")
          logger.info("Transaction committed successfully")
        } catch (err) {
          logger.error(`Transaction commit error: ${err.message}`)
          throw err
        } finally {
          client.release()
        }
      },
      rollback: async () => {
        try {
          await client.query("ROLLBACK")
          logger.info("Transaction rolled back")
        } catch (err) {
          logger.error(`Transaction rollback error: ${err.message}`)
        } finally {
          client.release()
        }
      },
      query: async (text, params) => {
        try {
          return await client.query(text, params)
        } catch (err) {
          logger.error(`Transaction query error: ${err.message}`)
          logger.error(`Query: ${text}`)
          logger.error(`Params: ${JSON.stringify(params)}`)
          throw err
        }
      },
    }
    next()
  } catch (err) {
    if (client) {
      client.release()
    }
    logger.error(`Transaction initialization error: ${err.message}`)

    // Handle Neon-specific errors
    if (err.message.includes("database is sleeping")) {
      res.status(503).json({
        error: "Database temporarily unavailable",
        message: "Database is waking up, please try again in a moment",
      })
    } else {
      res.status(500).json({ error: "Database error", message: "Failed to initialize transaction" })
    }
  }
}

/**
 * Retry connection logic for Neon database wake-up scenarios
 */
const retryConnection = async (maxRetries = 3, delay = 1000) => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const client = await pool.connect()
      return client
    } catch (err) {
      logger.warn(`Connection attempt ${i + 1} failed: ${err.message}`)

      if (i === maxRetries - 1) {
        throw err
      }

      // Wait before retrying (exponential backoff)
      await new Promise((resolve) => setTimeout(resolve, delay * Math.pow(2, i)))
    }
  }
}

/**
 * Execute a query with enhanced error handling and retry logic for Neon
 */
const executeQuery = async (text, params = [], retries = 2) => {
  const start = Date.now()

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await pool.query(text, params)
      const duration = Date.now() - start

      // Log slow queries for performance monitoring
      if (duration > 500) {
        logger.warn(`Slow query (${duration}ms): ${text.substring(0, 100)}...`)
      }

      return result
    } catch (err) {
      logger.error(`Query error (attempt ${attempt + 1}): ${err.message}`)

      // Don't retry on the last attempt or for certain error types
      if (attempt === retries || !shouldRetryError(err)) {
        logger.error(`Query: ${text}`)
        logger.error(`Params: ${JSON.stringify(params)}`)

        // Enhanced error handling for common PostgreSQL/Neon errors
        if (err.code === "23505") {
          throw new Error(`Duplicate key violation: ${err.detail || err.message}`)
        } else if (err.code === "23503") {
          throw new Error(`Foreign key constraint violation: ${err.detail || err.message}`)
        } else if (err.code === "42P01") {
          throw new Error(`Table does not exist: ${err.message}`)
        } else if (err.code === "42703") {
          throw new Error(`Column does not exist: ${err.message}`)
        } else if (err.message.includes("database is sleeping")) {
          throw new Error("Database is temporarily unavailable (waking up)")
        }

        throw err
      }

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)))
    }
  }
}

/**
 * Determine if an error should trigger a retry
 */
const shouldRetryError = (err) => {
  const retryableCodes = ["ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "ECONNREFUSED"]
  const retryableMessages = ["database is sleeping", "connection terminated", "server closed the connection"]

  return retryableCodes.includes(err.code) || retryableMessages.some((msg) => err.message.toLowerCase().includes(msg))
}

/**
 * Creates a table if it doesn't exist (optimized for Neon)
 */
const createTableIfNotExists = async (tableName, createTableSQL) => {
  try {
    // Check if table exists
    const tableCheck = await executeQuery(
      "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)",
      [tableName],
    )

    if (!tableCheck.rows[0].exists) {
      // Use a transaction for table creation with retry logic
      let client
      try {
        client = await retryConnection(3)
        await client.query("BEGIN")
        await client.query(createTableSQL)
        await client.query("COMMIT")
        logger.info(`Created table: ${tableName}`)
        return true
      } catch (err) {
        if (client) {
          await client.query("ROLLBACK")
        }
        logger.error(`Error creating table ${tableName}: ${err.message}`)
        throw err
      } finally {
        if (client) {
          client.release()
        }
      }
    }

    return false
  } catch (err) {
    logger.error(`Error checking/creating table ${tableName}: ${err.message}`)
    throw err
  }
}

/**
 * Check if a record exists with enhanced error handling
 */
const recordExists = async (table, field, value) => {
  try {
    const result = await executeQuery(`SELECT 1 FROM "${table}" WHERE "${field}" = $1 LIMIT 1`, [value])
    return result.rows.length > 0
  } catch (err) {
    logger.error(`Error checking if record exists in ${table}: ${err.message}`)
    throw err
  }
}

/**
 * Get a record by ID with proper error handling
 */
const getById = async (table, id, fields = "*") => {
  try {
    const result = await executeQuery(`SELECT ${fields} FROM "${table}" WHERE id = $1`, [id])
    return result.rows[0]
  } catch (err) {
    logger.error(`Error getting record by ID from ${table}: ${err.message}`)
    throw err
  }
}

/**
 * Insert a record and return the created object
 */
const insertRecord = async (table, data) => {
  const keys = Object.keys(data)
  const values = Object.values(data)
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ")
  const columns = keys.map((k) => `"${k}"`).join(", ")

  try {
    const result = await executeQuery(
      `INSERT INTO "${table}" (${columns}) VALUES (${placeholders}) RETURNING *`,
      values,
    )
    return result.rows[0]
  } catch (err) {
    logger.error(`Error inserting record into ${table}: ${err.message}`)
    throw err
  }
}

/**
 * Update a record by ID and return the updated object
 */
const updateById = async (table, id, data) => {
  const keys = Object.keys(data)
  const values = Object.values(data)
  const setClause = keys.map((k, i) => `"${k}" = $${i + 1}`).join(", ")

  try {
    const result = await executeQuery(`UPDATE "${table}" SET ${setClause} WHERE id = $${keys.length + 1} RETURNING *`, [
      ...values,
      id,
    ])
    return result.rows[0]
  } catch (err) {
    logger.error(`Error updating record in ${table}: ${err.message}`)
    throw err
  }
}

module.exports = {
  beginTransaction,
  executeQuery,
  recordExists,
  getById,
  insertRecord,
  updateById,
  createTableIfNotExists,
  retryConnection,
}
