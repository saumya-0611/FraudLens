// Users router for /api/users (CONTRACTS section 8).
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const { audit } = require('../audit/auditLogger');
const { query } = require('../config/db');
const { asyncHandler, AppError } = require('../utils/errors');
const validate = require('../middleware/validate');
const { createUser, patchUser } = require('../validation/schemas');

// GET /api/users
router.get(
  '/',
  authenticate,
  authorize('ADMIN'),
  asyncHandler(async (_req, res) => {
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
  validate(createUser),
  asyncHandler(async (req, res) => {
    const { username, password, role } = req.body;
    const pwdHash = await bcrypt.hash(password, 10);
    try {
      const result = await query(
        `INSERT INTO users (username, password_hash, role, status)
         VALUES ($1, $2, $3, 'ACTIVE')
         RETURNING id, username, role, status, created_at`,
        [username, pwdHash, role]
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
  validate(patchUser),
  asyncHandler(async (req, res) => {
    const targetId = Number(req.params.id);
    const { role, status, password } = req.body;
    // Prevent an admin from disabling or demoting themselves
    if (req.user?.id && Number(req.user.id) === targetId) {
      if (status === 'DISABLED' || (role && role !== 'ADMIN')) {
        throw new AppError(409, 'CONFLICT', 'An administrator cannot disable or demote their own account.');
      }
    }

    const pwdHash = password ? await bcrypt.hash(password, 10) : null;
    const result = await query(
      `UPDATE users
       SET role = COALESCE($1, role),
           status = COALESCE($2, status),
           password_hash = COALESCE($3, password_hash),
           failed_attempts = CASE WHEN $3 IS NULL THEN failed_attempts ELSE 0 END,
           locked_until = CASE WHEN $3 IS NULL THEN locked_until ELSE NULL END
       WHERE id = $4
       RETURNING id, username, role, status, created_at`,
      [role || null, status || null, pwdHash, targetId]
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
