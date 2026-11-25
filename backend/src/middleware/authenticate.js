
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

async function getSessionUser(req) {
  const tokenUser = verifyRequestCookie(req);
  if (!tokenUser) return null;

  const { rows: [user] } = await query(
    `SELECT id, username, role, status
     FROM users
     WHERE id = $1`,
    [tokenUser.id]
  );
  if (user?.status !== 'ACTIVE' || !['ADMIN', 'ANALYST', 'VIEWER'].includes(user.role)) {
    return null;
  }
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    ...(tokenUser.display_name ? { display_name: tokenUser.display_name } : {}),
  };
}

async function authenticate(req, res, next) {
  try {
    const user = await getSessionUser(req);
    if (!user) return sendUnauthorized(req, res);
    req.user = user;
    return next();
  } catch (error) {
    return next(error);
  }
}

module.exports = authenticate;
module.exports.getSessionUser = getSessionUser;
