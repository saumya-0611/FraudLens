const router = require('express').Router();

const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const validate = require('../middleware/validate');
const { alertPatch } = require('../validation/schemas');
const { audit } = require('../audit/auditLogger');
const { query } = require('../config/db');
const { asyncHandler, AppError } = require('../utils/errors');
const { maskAccount } = require('../utils/mask');

// GET /api/alerts - List alerts with optional state filter and pagination.
router.get(
  '/',
  authenticate,
  authorize('ADMIN', 'ANALYST'),
  asyncHandler(async (req, res) => {
    const state = req.query.state;

    if (state && !['NEW', 'UNDER_REVIEW', 'RESOLVED'].includes(state)) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Invalid alert state.');
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(req.query.page_size, 10) || 20)
    );

    const conditions = [];
    const params = [];

    if (state) {
      params.push(state);
      conditions.push(`a.state = $${params.length}`);
    }

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const countResult = await query(
      `SELECT COUNT(*) AS total
       FROM alerts a
       ${whereClause}`,
      params
    );

    const total = Number(countResult.rows[0].total);
    const offset = (page - 1) * pageSize;
    const dataParams = [...params, pageSize, offset];

    const result = await query(
      `SELECT
         a.alert_id,
         a.transaction_id,
         a.risk_score,
         a.state,
         a.resolution,
         a.resolved_by,
         a.created_at,
         a.updated_at,
         t.account_ref,
         t.amount,
         t.category,
         t.merchant,
         t.tx_time
       FROM alerts a
       JOIN transactions t
         ON t.transaction_id = a.transaction_id
       ${whereClause}
       ORDER BY a.created_at DESC
       LIMIT $${params.length + 1}
       OFFSET $${params.length + 2}`,
      dataParams
    );

    const items = result.rows.map((row) => ({
      alert_id: row.alert_id,
      transaction_id: row.transaction_id,
      account_masked: maskAccount(row.account_ref),
      amount: Number(row.amount),
      category: row.category,
      merchant: row.merchant,
      tx_time: row.tx_time,
      risk_category: 'HIGH_RISK',
      risk_score: row.risk_score,
      state: row.state,
      resolution: row.resolution,
      resolved_by: row.resolved_by,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));

    res.json({
      items,
      page,
      page_size: pageSize,
      total,
    });
  })
);

// PATCH /api/alerts/:id - Update an alert's state and resolution.
router.patch(
  '/:id',
  authenticate,
  authorize('ADMIN', 'ANALYST'),
  validate(alertPatch),
  asyncHandler(async (req, res) => {
    const { state, resolution } = req.body;

    const existing = await query(
      'SELECT alert_id, state FROM alerts WHERE alert_id = $1',
      [req.params.id]
    );

    if (existing.rows.length === 0) {
      throw new AppError(404, 'NOT_FOUND', 'Alert not found.');
    }

    const currentState = existing.rows[0].state;

    if (currentState === 'RESOLVED') {
      throw new AppError(409, 'CONFLICT', 'Resolved alerts cannot be changed.');
    }

    if (state === 'UNDER_REVIEW' && currentState !== 'NEW') {
      throw new AppError(409, 'CONFLICT', 'Invalid alert state transition.');
    }

    const resolvedByUserId =
      state === 'RESOLVED' && Number.isInteger(req.user?.id) && req.user.id > 0
        ? req.user.id
        : null;

    const result = await query(
      `UPDATE alerts
       SET state = $1,
           resolution = $2,
           resolved_by = $3,
           updated_at = NOW()
       WHERE alert_id = $4
         AND state <> 'RESOLVED'
       RETURNING alert_id, transaction_id, risk_score, state,
                 resolution, resolved_by, created_at, updated_at`,
      [
        state,
        state === 'RESOLVED' ? resolution : null,
        resolvedByUserId,
        req.params.id,
      ]
    );

    if (result.rows.length === 0) {
      throw new AppError(409, 'CONFLICT', 'Alert was already resolved.');
    }

    try {
      await audit({
        req,
        userId: req.user?.id,
        username: req.user?.username || 'system',
        action: 'ALERT_STATE_CHANGED',
        entity: 'alert',
        entityId: String(req.params.id),
        details: { state, resolution: state === 'RESOLVED' ? resolution : null },
      });
    } catch (auditErr) {
      console.error('[AlertsRoute] Audit log failed:', auditErr.message);
    }

    res.json(result.rows[0]);
  })
);

module.exports = router;
