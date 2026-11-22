// Users router for /api/users (CONTRACTS section 8).
const crypto = require('crypto');
const router = require('express').Router();
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const { audit } = require('../audit/auditLogger');
const { query } = require('../config/db');
const { asyncHandler, AppError } = require('../utils/errors');

async function ensureDefaultUsersSeeded() {
  const countRes = await query('SELECT COUNT(*) AS c FROM users');
  if (Number(countRes.rows[0]?.c || 0) === 0) {
    const defaults = [
      ['admin', 'ADMIN'],
      ['analyst', 'ANALYST'],
      ['viewer', 'VIEWER'],
    ];
    for (const [uname, role] of defaults) {
      const hash = crypto.createHash('sha256').update(`seed:${uname}`).digest('hex');
      await query(
        `INSERT INTO users (username, password_hash, role, status)
         VALUES ($1, $2, $3, 'ACTIVE')
         ON CONFLICT (username) DO NOTHING`,
        [uname, hash, role]
      );
    }
  }
}

// GET /api/users
router.get(
  '/',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (_req, res) => {
    await ensureDefaultUsersSeeded();
    const result = await query(
      `SELECT id, username, role, status, created_at
       FROM users
       ORDER BY id ASC`
    );
    res.json({ items: result.rows });
  })
);

// POST /api/users
router.post(
  '/',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const { username, password, role } = req.body || {};
    if (!username || !password || !['ADMIN', 'ANALYST', 'VIEWER'].includes(role)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Valid username, password, and role are required.');
    }
    const pwdHash = crypto.createHash('sha256').update(String(password)).digest('hex');
    try {
      const result = await query(
        `INSERT INTO users (username, password_hash, role, status)
         VALUES ($1, $2, $3, 'ACTIVE')
         RETURNING id, username, role, status, created_at`,
        [String(username).trim(), pwdHash, role]
      );
      const created = result.rows[0];
      await audit({
        req,
        userId: req.user?.id,
        username: req.user?.username,
        action: 'USER_CREATED',
        entity: 'user',
        entityId: String(created.id),
        details: { username: created.username, role: created.role },
      });
      res.status(201).json(created);
    } catch (err) {
      if (err.code === '23505') {
        throw new AppError(409, 'CONFLICT', 'Username already exists.');
      }
      throw err;
    }
  })
);

// PATCH /api/users/:id
router.patch(
  '/:id',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (req, res) => {
    const { role, status } = req.body || {};
    if (role && !['ADMIN', 'ANALYST', 'VIEWER'].includes(role)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid role.');
    }
    if (status && !['ACTIVE', 'DISABLED'].includes(status)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid status.');
    }
    const result = await query(
      `UPDATE users
       SET role = COALESCE($1, role),
           status = COALESCE($2, status)
       WHERE id = $3
       RETURNING id, username, role, status, created_at`,
      [role || null, status || null, req.params.id]
    );
    if (result.rows.length === 0) {
      throw new AppError(404, 'NOT_FOUND', 'User not found.');
    }
    const updated = result.rows[0];
    await audit({
      req,
      userId: req.user?.id,
      username: req.user?.username,
      action: 'USER_UPDATED',
      entity: 'user',
      entityId: String(updated.id),
      details: { role: updated.role, status: updated.status },
    });
    res.json(updated);
  })
);

module.exports = router;
