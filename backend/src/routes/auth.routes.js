
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');

const { query } = require('../config/db');
const { cookieOptions, issueSession } = require('../auth/session');
const authenticate = require('../middleware/authenticate');
const { audit } = require('../audit/auditLogger');
const validate = require('../middleware/validate');
const { login } = require('../validation/schemas');

const VALID_ROLES = new Set(['ADMIN', 'ANALYST', 'VIEWER']);

// Used for unknown accounts so they still perform a bcrypt comparison.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-user-password', 10);
const BCRYPT_HASH = /^\$2[aby]\$(0[4-9]|[12]\d|3[01])\$[./A-Za-z0-9]{53}$/;

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
router.post('/login', loginLimiter, validate(login), async (req, res, next) => {
  try {
    const { username, password } = req.body;

    const result = await query(
      `SELECT id, username, password_hash, role, status,
              locked_until
       FROM users
       WHERE username = $1`,
      [username]
    );

    const user = result.rows[0];

    const hasBcryptHash = BCRYPT_HASH.test(user?.password_hash);
    const passwordMatches = await bcrypt.compare(
      password,
      hasBcryptHash ? user.password_hash : DUMMY_HASH
    );

    const locked = user?.locked_until &&
      new Date(user.locked_until).getTime() > Date.now();

    const validAccount =
      user &&
      hasBcryptHash &&
      user.status === 'ACTIVE' &&
      VALID_ROLES.has(user.role);
    const auditFailure = () => auditSafely({
      req,
      userId: user?.id ?? null,
      username,
      action: 'LOGIN_FAILURE',
      entity: 'USER',
      entityId: user ? String(user.id) : null,
      details: {},
    });

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
             AND password_hash = $2
             AND status = 'ACTIVE'
             AND (locked_until IS NULL OR locked_until <= now())`,
          [user.id, user.password_hash]
        );
      }

      await auditFailure();
      return invalidCredentials(req, res);
    }

    // Re-check status and lock in the UPDATE before issuing a token.
    // The database remains the authority for access on every request.
    const updated = await query(
      `UPDATE users
       SET failed_attempts = 0, locked_until = NULL
       WHERE id = $1
         AND password_hash = $2
         AND status = 'ACTIVE'
         AND (locked_until IS NULL OR locked_until <= now())
       RETURNING id, username, role`,
      [user.id, user.password_hash]
    );

    const currentUser = updated.rows[0];
    if (!currentUser || !VALID_ROLES.has(currentUser.role)) {
      await auditFailure();
      return invalidCredentials(req, res);
    }

    const lifetime = issueSession(res, currentUser);

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
      expires_in: lifetime,
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
  return res.set('Cache-Control', 'no-store').status(200).json({
    username: req.user.username,
    role: req.user.role,
    ...(req.user.display_name ? { display_name: req.user.display_name } : {}),
  });
});

router.use(require('./oauth.routes'));

module.exports = router;
