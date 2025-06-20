const logger = require("./logger")

module.exports = (roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      logger.warn(`Access denied for user ${req.user?.id} with role ${req.user?.role}`)
      return res.status(403).json({ error: "Insufficient permissions" })
    }
    next()
  }
}
