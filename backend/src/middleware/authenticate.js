
const { verifyRequestCookie } = require('../utils/jwt');
const { query } = require('../config/db');

function sendUnauthorized(req, res) {
  return res.status(401).json({
    error: {
      code: 'UNAUTHENTICATED',
      message: 'Authentication required.',
      request_id: req.id,
    },
  });
}

async function authenticate(req, res, next) {
  const tokenUser = verifyRequestCookie(req);

  if (!tokenUser) {
    return sendUnauthorized(req, res);
  }

  try {
    const result = await query(
      `SELECT id, username, role, status
       FROM users
       WHERE id = $1`,
      [tokenUser.id]
    );

    const user = result.rows[0];

    if (!user || user.status !== 'ACTIVE') {
      return sendUnauthorized(req, res);
    }

    // Trust the current database role, not a potentially stale JWT role.
    req.user = {
      id: user.id,
      username: user.username,
      role: user.role,
    };

    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = authenticate;
