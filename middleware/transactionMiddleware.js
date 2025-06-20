/**
 * Transaction middleware
 * Adds PostgreSQL transaction support to routes
 */
const { beginTransaction } = require("../utils/dbUtils")

/**
 * Middleware that starts a database transaction and attaches it to the request object
 * The transaction can be accessed via req.dbTransaction in route handlers
 *
 * Usage:
 * router.post('/resource', transactionMiddleware, controller.createResource)
 */
module.exports = beginTransaction
