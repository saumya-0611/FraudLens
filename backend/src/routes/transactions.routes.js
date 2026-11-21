const router = require('express').Router();

const serviceAuth = require('../middleware/serviceAuth');
const validate = require('../middleware/validate');
const { createTransaction, listQuery } = require('../validation/schemas');
const { publishTransaction } = require('../kafka/producer');
const { asyncHandler } = require('../utils/errors');
const { query } = require('../config/db');
const { maskAccount } = require('../utils/mask');

// GET /api/transactions - List transactions with filters and pagination.
router.get(
  '/',
  validate(listQuery),
  asyncHandler(async (req, res) => {
    const {
      risk,
      from,
      to,
      q,
    } = req.query;

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(req.query.page_size, 10) || 20)
    );

    const conditions = [];
    const params = [];

    if (risk) {
      params.push(risk);
      conditions.push(`COALESCE(fr.risk_category, 'PENDING') = $${params.length}`);
    }

    if (from) {
      params.push(from);
      conditions.push(`t.tx_time >= $${params.length}::timestamptz`);
    }

    if (to) {
      params.push(to);
      conditions.push(`t.tx_time <= $${params.length}::timestamptz`);
    }

    if (q) {
      params.push(`%${q}%`);
      conditions.push(`(
        t.transaction_id ILIKE $${params.length}
        OR t.account_ref ILIKE $${params.length}
        OR t.merchant ILIKE $${params.length}
        OR t.category ILIKE $${params.length}
      )`);
    }

    const whereClause = conditions.length
      ? `WHERE ${conditions.join(' AND ')}`
      : '';

    const countResult = await query(
      `SELECT COUNT(*) AS total
       FROM transactions t
       LEFT JOIN fraud_results fr
         ON fr.transaction_id = t.transaction_id
       LEFT JOIN alerts a
         ON a.transaction_id = t.transaction_id
       ${whereClause}`,
      params
    );

    const total = Number(countResult.rows[0].total);
    const offset = (page - 1) * pageSize;

    const dataParams = [...params, pageSize, offset];

    const result = await query(
      `SELECT
         t.transaction_id,
         t.account_ref,
         t.amount,
         t.category,
         t.merchant,
         t.tx_time,
         COALESCE(fr.risk_category, 'PENDING') AS risk_category,
         fr.fraud_probability,
         COALESCE(fr.is_anomaly, false) AS is_anomaly,
         fr.model_version,
         a.alert_id,
         a.state AS alert_state,
         a.resolution AS alert_resolution
       FROM transactions t
       LEFT JOIN fraud_results fr
         ON fr.transaction_id = t.transaction_id
       LEFT JOIN alerts a
         ON a.transaction_id = t.transaction_id
       ${whereClause}
       ORDER BY t.tx_time DESC
       LIMIT $${params.length + 1}
       OFFSET $${params.length + 2}`,
      dataParams
    );

    const items = result.rows.map((row) => ({
      transaction_id: row.transaction_id,
      account_masked: maskAccount(row.account_ref),
      amount: Number(row.amount),
      category: row.category,
      merchant: row.merchant,
      tx_time: row.tx_time,
      risk_category: row.risk_category,
      fraud_probability: row.fraud_probability,
      is_anomaly: row.is_anomaly,
      model_version: row.model_version,
      alert: row.alert_id
        ? {
            alert_id: row.alert_id,
            state: row.alert_state,
            resolution: row.alert_resolution,
          }
        : null,
    }));

    res.json({
      items,
      page,
      page_size: pageSize,
      total,
    });
  })
);


// GET /api/transactions/:id - Get complete transaction details.
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const result = await query(
      `SELECT
         t.transaction_id,
         t.account_ref,
         t.amount,
         t.category,
         t.merchant,
         t.tx_time,
         t.ingested_at,
         fr.risk_category,
         fr.fraud_probability,
         fr.anomaly_score,
         fr.is_anomaly,
         fr.top_reasons,
         fr.features,
         fr.model_version,
         fr.scored_at,
         a.alert_id,
         a.state AS alert_state,
         a.resolution AS alert_resolution,
         a.created_at AS alert_created_at,
         a.updated_at AS alert_updated_at
       FROM transactions t
       LEFT JOIN fraud_results fr
         ON fr.transaction_id = t.transaction_id
       LEFT JOIN alerts a
         ON a.transaction_id = t.transaction_id
       WHERE t.transaction_id = $1`,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: 'Transaction not found.',
          request_id: req.id,
        },
      });
    }

    const row = result.rows[0];

    res.json({
      transaction_id: row.transaction_id,
      account_masked: maskAccount(row.account_ref),
      amount: Number(row.amount),
      category: row.category,
      merchant: row.merchant,
      risk_category: row.risk_category || 'PENDING',
      fraud_probability: row.fraud_probability,
      anomaly_score: row.anomaly_score,
      is_anomaly: row.is_anomaly ?? false,
      model_version: row.model_version,
      top_reasons: row.top_reasons || [],
      features: row.features || {},
      timestamps: {
        tx_time: row.tx_time,
        ingested_at: row.ingested_at,
        scored_at: row.scored_at,
      },
      alert: row.alert_id
        ? {
            alert_id: row.alert_id,
            state: row.alert_state,
            resolution: row.alert_resolution,
            created_at: row.alert_created_at,
            updated_at: row.alert_updated_at,
          }
        : null,
    });
  })
);
// POST /api/transactions - Accept a transaction and publish it to Kafka.
router.post(
  '/',
  serviceAuth,
  validate(createTransaction),
  asyncHandler(async (req, res) => {
    const transaction = req.body;

    await publishTransaction(transaction);

    res.status(202).json({
      transaction_id: transaction.transaction_id,
      status: 'ACCEPTED',
    });
  })
);

module.exports = router;
