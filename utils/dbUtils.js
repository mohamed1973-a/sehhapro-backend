/**
 * Database utilities for common operations
 * Optimized for PostgreSQL and transaction management
 */
const { pool } = require("../config/database")
const logger = require("../middleware/logger")

/**
 * Begin a database transaction and attach it to the request object
 * Improved error handling and connection management
 */
const beginTransaction = async (req, res, next) => {
  const client = await pool.connect()
  try {
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
    client.release()
    logger.error(`Transaction initialization error: ${err.message}`)
    res.status(500).json({ error: "Database error", message: "Failed to initialize transaction" })
  }
}

/**
 * Execute a query with proper error handling and logging
 * Optimized for PostgreSQL syntax
 */
const executeQuery = async (text, params = []) => {
  const start = Date.now()
  try {
    const result = await pool.query(text, params)
    const duration = Date.now() - start

    // Log slow queries for performance monitoring
    if (duration > 200) {
      logger.warn(`Slow query (${duration}ms): ${text}`)
    }

    return result
  } catch (err) {
    logger.error(`Query error: ${err.message}`)
    logger.error(`Query: ${text}`)
    logger.error(`Params: ${JSON.stringify(params)}`)

    // Enhanced error handling for common PostgreSQL errors
    if (err.code === "23505") {
      throw new Error(`Duplicate key violation: ${err.detail || err.message}`)
    } else if (err.code === "23503") {
      throw new Error(`Foreign key constraint violation: ${err.detail || err.message}`)
    } else if (err.code === "42P01") {
      throw new Error(`Table does not exist: ${err.message}`)
    } else if (err.code === "42703") {
      throw new Error(`Column does not exist: ${err.message}`)
    }

    throw err
  }
}

/**
 * Creates a table if it doesn't exist
 * @param {string} tableName - Name of the table to check/create
 * @param {string} createTableSQL - SQL to create the table
 * @returns {Promise<boolean>} True if table was created, false if it already existed
 */
const createTableIfNotExists = async (tableName, createTableSQL) => {
  try {
    // Check if table exists
    const tableCheck = await executeQuery(
      "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)",
      [tableName],
    )

    if (!tableCheck.rows[0].exists) {
      // Fix: Use a transaction for table creation
      const client = await pool.connect()
      try {
        await client.query("BEGIN")
        await client.query(createTableSQL)
        await client.query("COMMIT")
        logger.info(`Created table: ${tableName}`)
        return true
      } catch (err) {
        await client.query("ROLLBACK")
        logger.error(`Error creating table ${tableName}: ${err.message}`)
        throw err
      } finally {
        client.release()
      }
    }

    return false
  } catch (err) {
    logger.error(`Error checking/creating table ${tableName}: ${err.message}`)
    throw err
  }
}

/**
 * Check if a record exists with improved error handling
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
 * Supports selecting specific fields
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
 * Optimized for PostgreSQL RETURNING clause
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
 * Optimized for PostgreSQL RETURNING clause
 */
const updateById = async (table, id, data) => {
  const keys = Object.keys(data)
  const values = Object.values(data)

  // Build SET clause with proper parameter indexing
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
}
