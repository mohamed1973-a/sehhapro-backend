/**
 * Schema Checker Utility
 * Checks database schema and reports missing columns/tables
 */
const { pool } = require("../config/database")
const logger = require("../middleware/logger")

/**
 * Check if a table exists
 */
async function tableExists(tableName) {
  try {
    const result = await pool.query("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)", [
      tableName,
    ])
    return result.rows[0].exists
  } catch (error) {
    logger.error(`Error checking table ${tableName}:`, error)
    return false
  }
}

/**
 * Check if a column exists in a table
 */
async function columnExists(tableName, columnName) {
  try {
    const result = await pool.query(
      "SELECT EXISTS (SELECT FROM information_schema.columns WHERE table_name = $1 AND column_name = $2)",
      [tableName, columnName],
    )
    return result.rows[0].exists
  } catch (error) {
    logger.error(`Error checking column ${columnName} in table ${tableName}:`, error)
    return false
  }
}

/**
 * Get all columns for a table
 */
async function getTableColumns(tableName) {
  try {
    const result = await pool.query(
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position",
      [tableName],
    )
    return result.rows
  } catch (error) {
    logger.error(`Error getting columns for table ${tableName}:`, error)
    return []
  }
}

/**
 * Check database schema and report issues
 */
async function checkDatabaseSchema() {
  try {
    logger.info("Checking database schema...")

    // Check essential tables
    const essentialTables = ["users", "roles", "clinics", "appointments"]
    for (const table of essentialTables) {
      const exists = await tableExists(table)
      if (exists) {
        logger.info(`✓ Table '${table}' exists`)
        const columns = await getTableColumns(table)
        logger.info(`  Columns: ${columns.map((c) => `${c.column_name}(${c.data_type})`).join(", ")}`)
      } else {
        logger.warn(`✗ Table '${table}' does not exist`)
      }
    }

    // Check users table specifically
    const usersExists = await tableExists("users")
    if (usersExists) {
      const userColumns = await getTableColumns("users")
      const hasClinicId = await columnExists("users", "clinic_id")
      const hasRoleId = await columnExists("users", "role_id")

      logger.info(`Users table columns: ${userColumns.map((c) => c.column_name).join(", ")}`)
      logger.info(`Has clinic_id: ${hasClinicId}`)
      logger.info(`Has role_id: ${hasRoleId}`)
    }

    logger.info("Schema check completed")
  } catch (error) {
    logger.error("Error checking database schema:", error)
  }
}

module.exports = {
  tableExists,
  columnExists,
  getTableColumns,
  checkDatabaseSchema,
}
