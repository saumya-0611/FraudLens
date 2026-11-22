
const { audit } = require('../audit/auditLogger');

module.exports = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Authentication required.',
          request_id: req.id,
        },
      });
    }

    if (!roles.includes(req.user.role)) {
      // Audit asynchronously, without blocking the response.
      Promise.resolve()
        .then(() => audit({
          req,
          userId: req.user.id,
          username: req.user.username,
          action: 'ACCESS_DENIED',
          entity: 'API',
          entityId: (req.baseUrl + req.path).slice(0, 64),
          details: {
            method: req.method,
            role: req.user.role,
            required_roles: roles,
          },
        }))
        .catch((error) => {
          console.error('ACCESS_DENIED audit failed:', error);
        });

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
};
