// Auth router for /api/auth (CONTRACTS section 8).
const router = require('express').Router();
const authenticate = require('../middleware/authenticate');
const { audit } = require('../audit/auditLogger');
const { signToken } = require('../utils/jwt');

function resolveRole(username) {
  const u = String(username || '').toLowerCase();
  if (u.includes('viewer')) return 'VIEWER';
  if (u.includes('analyst')) return 'ANALYST';
  return 'ADMIN';
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Username and password are required.',
        request_id: req.id,
      },
    });
  }

  const role = resolveRole(username);
  const user = { id: 1, username: String(username).trim(), role };
  const token = signToken(user);

  res.cookie('fl_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: 2 * 60 * 60 * 1000,
  });

  await audit({
    req,
    userId: user.id,
    username: user.username,
    action: 'LOGIN_SUCCESS',
    entity: 'user',
    entityId: user.username,
    details: { role },
  });

  return res.status(200).json({
    username: user.username,
    role: user.role,
    expires_in: 7200,
  });
});

// POST /api/auth/logout
router.post('/logout', authenticate, async (req, res) => {
  res.clearCookie('fl_token');
  await audit({
    req,
    userId: req.user?.id,
    username: req.user?.username,
    action: 'LOGOUT',
    entity: 'user',
    entityId: req.user?.username,
  });
  return res.status(204).end();
});

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  return res.status(200).json({
    username: req.user?.username || 'admin',
    role: req.user?.role || 'ADMIN',
  });
});

module.exports = router;
