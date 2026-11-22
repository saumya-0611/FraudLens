
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');

const { query } = require('../config/db');
const { signToken } = require('../utils/jwt');
const authenticate = require('../middleware/authenticate');
const { audit } = require('../audit/auditLogger');

const VALID_ROLES = new Set(['ADMIN', 'ANALYST', 'VIEWER']);

// Used for unknown accounts so they still perform a bcrypt comparison.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-user-password', 10);

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => res.status(429).json({
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many login attempts. Try again later.',
      request_id: req.id,
    },
  }),
});

const cookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.COOKIE_SECURE === 'true',
  path: '/',
});

function invalidCredentials(req, res) {
  return res.status(401).json({
    error: {
      code: 'INVALID_CREDENTIALS',
      message: 'Invalid username or password.',
      request_id: req.id,
    },
  });
}

async function auditSafely(entry) {
  try {
    await audit(entry);
  } catch (error) {
    console.error('Authentication audit failed:', error);
  }
}

// C3: POST /api/auth/login
router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};

    // Temporary route-local validation. C5 will introduce Zod schemas.
    if (
      typeof username !== 'string' ||
      !/^[a-zA-Z0-9_.-]{3,50}$/.test(username) ||
      typeof password !== 'string' ||
      password.length === 0 ||
      password.length > 1024
    ) {
      return res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid login request.',
          request_id: req.id,
        },
      });
    }

    const result = await query(
      `SELECT id, username, password_hash, role, status,
              failed_attempts, locked_until
       FROM users
       WHERE username = $1`,
      [username]
    );

    const user = result.rows[0];

    const passwordMatches = await bcrypt.compare(
      password,
      user ? user.password_hash : DUMMY_HASH
    );

    const locked = user?.locked_until &&
      new Date(user.locked_until).getTime() > Date.now();

    const validAccount =
      user &&
      user.status === 'ACTIVE' &&
      VALID_ROLES.has(user.role);

    if (!validAccount || !passwordMatches || locked) {
      if (validAccount && !passwordMatches && !locked) {
        // Atomic increment; an expired lock starts a new attempt window.
        await query(
          `UPDATE users
           SET failed_attempts =
                 CASE
                   WHEN locked_until IS NOT NULL
                    AND locked_until <= now()
                   THEN 1
                   ELSE failed_attempts + 1
                 END,
               locked_until =
                 CASE
                   WHEN (
                     CASE
                       WHEN locked_until IS NOT NULL
                        AND locked_until <= now()
                       THEN 1
                       ELSE failed_attempts + 1
                     END
                   ) >= 5
                   THEN now() + INTERVAL '15 minutes'
                   ELSE NULL
                 END
           WHERE id = $1
             AND (locked_until IS NULL OR locked_until <= now())`,
          [user.id]
        );
      }

      await auditSafely({
        req,
        userId: user?.id ?? null,
        username,
        action: 'LOGIN_FAILURE',
        entity: 'USER',
        entityId: user ? String(user.id) : null,
        details: {},
      });

      return invalidCredentials(req, res);
    }

    // Re-check status and lock in the UPDATE before issuing a token.
    // The database remains the authority for access on every request.
    const updated = await query(
      `UPDATE users
       SET failed_attempts = 0, locked_until = NULL
       WHERE id = $1
         AND status = 'ACTIVE'
         AND (locked_until IS NULL OR locked_until <= now())
       RETURNING id, username, role`,
      [user.id]
    );

    const currentUser = updated.rows[0];
    if (!currentUser || !VALID_ROLES.has(currentUser.role)) {
      return invalidCredentials(req, res);
    }

    const token = signToken(currentUser);
    const decoded = require('jsonwebtoken').decode(token);

    if (!decoded || typeof decoded.exp !== 'number') {
      throw new Error('JWT expiry missing');
    }

    const maxAge = Math.max(0, decoded.exp * 1000 - Date.now());

    res.cookie('fl_token', token, {
      ...cookieOptions(),
      maxAge,
    });

    await auditSafely({
      req,
      userId: currentUser.id,
      username: currentUser.username,
      action: 'LOGIN_SUCCESS',
      entity: 'USER',
      entityId: String(currentUser.id),
      details: {},
    });

    return res.status(200).json({
      username: currentUser.username,
      role: currentUser.role,
      expires_in: Math.max(0, Math.floor(maxAge / 1000)),
    });
  } catch (error) {
    return next(error);
  }
});

// C3: POST /api/auth/logout
router.post('/logout', authenticate, async (req, res) => {
  res.clearCookie('fl_token', cookieOptions());

  await auditSafely({
    req,
    userId: req.user.id,
    username: req.user.username,
    action: 'LOGOUT',
    entity: 'USER',
    entityId: String(req.user.id),
    details: {},
  });

  return res.status(204).end();
});

// C3: GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  return res.status(200).json({
    username: req.user.username,
    role: req.user.role,
  });
});

module.exports = router;
