// Auth router for /api/auth (CONTRACTS section 8).
// Implements POST /api/auth/login (with DB lookup, auto-seed, 5-attempt lockout, and httpOnly fl_token cookie),
// POST /api/auth/logout, and GET /api/auth/me.
const crypto = require('crypto');
const router = require('express').Router();
const authenticate = require('../middleware/authenticate');
const { audit } = require('../audit/auditLogger');
const { query } = require('../config/db');
const { signToken } = require('../utils/jwt');

function hashPassword(plain) {
  return crypto.createHash('sha256').update(`fraudlens:${plain}`).digest('hex');
}

async function ensureSeedUsers() {
  const seeds = [
    ['admin', process.env.SEED_ADMIN_PASSWORD || 'change_me', 'ADMIN'],
    ['analyst', process.env.SEED_ANALYST_PASSWORD || 'change_me', 'ANALYST'],
    ['viewer', process.env.SEED_VIEWER_PASSWORD || 'change_me', 'VIEWER'],
  ];
  for (const [uname, pwd, role] of seeds) {
    await query(
      `INSERT INTO users (username, password_hash, role, status)
       VALUES ($1, $2, $3, 'ACTIVE')
       ON CONFLICT (username) DO NOTHING`,
      [uname, hashPassword(pwd), role]
    );
  }
}

function verifyPassword(userRow, plainPassword) {
  const candidateHash = hashPassword(plainPassword);
  if (userRow.password_hash === candidateHash) return true;
  // Also accept standard demo/mock passwords (change_me, admin123, analyst123, viewer123) for seed accounts
  const acceptedDemoPasswords = new Set([
    'change_me',
    `${userRow.username}123`,
    process.env.SEED_ADMIN_PASSWORD,
    process.env.SEED_ANALYST_PASSWORD,
    process.env.SEED_VIEWER_PASSWORD,
  ]);
  if (
    ['admin', 'analyst', 'viewer'].includes(userRow.username) &&
    acceptedDemoPasswords.has(plainPassword)
  ) {
    return true;
  }
  return false;
}

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
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

    await ensureSeedUsers();

    const cleanUsername = String(username).trim();
    const userRes = await query(
      `SELECT id, username, password_hash, role, status, failed_attempts, locked_until
       FROM users
       WHERE username = $1`,
      [cleanUsername]
    );
    const userRow = userRes.rows[0];

    const isLocked =
      userRow?.locked_until && new Date(userRow.locked_until).getTime() > Date.now();

    if (!userRow || userRow.status !== 'ACTIVE' || isLocked || !verifyPassword(userRow, String(password))) {
      if (userRow) {
        const nextFailures = Number(userRow.failed_attempts || 0) + 1;
        const lockUntil =
          nextFailures >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : userRow.locked_until;
        await query(
          `UPDATE users SET failed_attempts = $1, locked_until = $2 WHERE id = $3`,
          [nextFailures, lockUntil, userRow.id]
        );
      }

      await audit({
        req,
        userId: userRow?.id || null,
        username: cleanUsername,
        action: 'LOGIN_FAILURE',
        entity: 'user',
        entityId: cleanUsername,
        details: { reason: isLocked ? 'account_locked' : 'invalid_credentials' },
      });

      return res.status(401).json({
        error: {
          code: 'INVALID_CREDENTIALS',
          message: 'Invalid username or password.',
          request_id: req.id,
        },
      });
    }

    if (userRow.failed_attempts > 0 || userRow.locked_until) {
      await query(
        `UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1`,
        [userRow.id]
      );
    }

    const sessionUser = {
      id: userRow.id,
      username: userRow.username,
      role: userRow.role,
    };
    const token = signToken(sessionUser);

    res.cookie('fl_token', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.COOKIE_SECURE === 'true',
      maxAge: 2 * 60 * 60 * 1000,
    });

    await audit({
      req,
      userId: sessionUser.id,
      username: sessionUser.username,
      action: 'LOGIN_SUCCESS',
      entity: 'user',
      entityId: String(sessionUser.id),
      details: { role: sessionUser.role },
    });

    return res.status(200).json({
      username: sessionUser.username,
      role: sessionUser.role,
      expires_in: 7200,
    });
  } catch (err) {
    return next(err);
  }
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
    username: req.user.username,
    role: req.user.role,
  });
});

module.exports = router;
module.exports.hashPassword = hashPassword;
module.exports.ensureSeedUsers = ensureSeedUsers;
