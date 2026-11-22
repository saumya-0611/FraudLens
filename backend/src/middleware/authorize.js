// Role-based access control middleware (CONTRACTS section 2 & 9).
// Returns 403 FORBIDDEN and writes an ACCESS_DENIED audit event if req.user.role is not permitted.
const { audit } = require('../audit/auditLogger');

module.exports = (...roles) => (req, res, next) => {
  const userRole = req.user?.role;
  if (!userRole || (roles.length > 0 && !roles.includes(userRole))) {
    Promise.resolve()
      .then(() =>
        audit({
          req,
          userId: req.user?.id,
          username: req.user?.username || 'anonymous',
          action: 'ACCESS_DENIED',
          entity: 'endpoint',
          entityId: req.originalUrl || req.url,
          details: { required_roles: roles, actual_role: userRole || null },
        })
      )
      .catch(() => {});

    return res.status(403).json({
      error: {
        code: 'FORBIDDEN',
        message: 'You do not have access to this resource.',
        request_id: req.id,
      },
    });
  }
  return next();
};
