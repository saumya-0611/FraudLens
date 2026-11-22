// Audit logs router for /api/audit-logs (CONTRACTS section 8).
const router = require('express').Router();
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const { auditQuery } = require('../validation/schemas');
const { query } = require('../config/db');
const { asyncHandler } = require('../utils/errors');

// GET /api/audit-logs
router.get(
  '/',
  authenticate,
  authorize('ADMIN'),
  validate(auditQuery),
  asyncHandler(async (req, res) => {
    const { action, username } = req.query;
    const includeHash = req.query.include_hash === 'true';
    const page = Number(req.query.page || 1);
    const pageSize = Number(req.query.page_size || 20);

    const conditions = [];
    const params = [];
    if (action) {
      params.push(action);
      conditions.push(`action = $${params.length}`);
    }
    if (username) {
      params.push(username);
      conditions.push(`username = $${params.length}`);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await query(
      `SELECT COUNT(*) AS total FROM audit_logs ${whereClause}`,
      params
    );
    const total = Number(countRes.rows[0]?.total || 0);
    const offset = (page - 1) * pageSize;

    const cols = includeHash
      ? 'id, event_time, user_id, username, action, entity, entity_id, details, ip, prev_hash, entry_hash'
      : 'id, event_time, user_id, username, action, entity, entity_id, details, ip';

    const rowsRes = await query(
      `SELECT ${cols}
       FROM audit_logs
       ${whereClause}
       ORDER BY event_time DESC, id DESC
       LIMIT $${params.length + 1}
       OFFSET $${params.length + 2}`,
      [...params, pageSize, offset]
    );

    res.json({
      items: rowsRes.rows,
      page,
      page_size: pageSize,
      total,
    });
  })
);

module.exports = router;
