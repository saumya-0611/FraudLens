const router = require('express').Router();
const authenticate = require('../middleware/authenticate');
const { query } = require('../config/db');
const { asyncHandler, AppError } = require('../utils/errors');
const { isProducerConnected } = require('../kafka/producer');

const { checkMlReadiness } = require('../utils/mlReadiness');

// GET /api/dashboard/summary - System & Fraud Detection Summary Statistics
router.get(
  '/summary',
  authenticate,
  asyncHandler(async (req, res) => {
    // 1. Transactions & Fraud Results Aggregation
    const txSql = `
      SELECT
        COUNT(t.transaction_id)::int AS total_transactions,
        COALESCE(SUM(t.amount), 0)::numeric AS total_amount,
        COUNT(*) FILTER (WHERE fr.risk_category = 'LEGITIMATE')::int AS legitimate,
        COUNT(*) FILTER (WHERE fr.risk_category = 'SUSPICIOUS')::int AS suspicious,
        COUNT(*) FILTER (WHERE fr.risk_category = 'HIGH_RISK')::int AS high_risk,
        COUNT(*) FILTER (WHERE fr.risk_category IS NULL OR fr.risk_category = 'PENDING')::int AS pending,
        COUNT(*) FILTER (WHERE fr.risk_category IN ('SUSPICIOUS', 'HIGH_RISK') OR fr.is_anomaly = true)::int AS flagged_transactions
      FROM transactions t
      LEFT JOIN fraud_results fr
        ON fr.transaction_id = t.transaction_id;
    `;

    // 2. Alerts Aggregation
    const alertSql = `
      SELECT
        COUNT(*)::int AS total_alerts,
        COUNT(*) FILTER (WHERE state = 'NEW')::int AS new_alerts,
        COUNT(*) FILTER (WHERE state = 'UNDER_REVIEW')::int AS alerts_under_review,
        COUNT(*) FILTER (WHERE state IN ('NEW', 'UNDER_REVIEW'))::int AS open_alerts,
        COUNT(*) FILTER (WHERE state = 'RESOLVED')::int AS resolved_alerts
      FROM alerts;
    `;

    // 3. Latency Percentiles (p50 scoring, p95 scoring, p95 alert) in milliseconds
    const latencySql = `
      SELECT
        COALESCE(
          (
            SELECT percentile_cont(0.50) WITHIN GROUP (
              ORDER BY EXTRACT(EPOCH FROM (fr.scored_at - t.ingested_at)) * 1000
            )
            FROM fraud_results fr
            JOIN transactions t ON t.transaction_id = fr.transaction_id
            WHERE fr.scored_at IS NOT NULL AND t.ingested_at IS NOT NULL AND fr.scored_at >= t.ingested_at
          ), 0
        ) AS score_p50,
        COALESCE(
          (
            SELECT percentile_cont(0.95) WITHIN GROUP (
              ORDER BY EXTRACT(EPOCH FROM (fr.scored_at - t.ingested_at)) * 1000
            )
            FROM fraud_results fr
            JOIN transactions t ON t.transaction_id = fr.transaction_id
            WHERE fr.scored_at IS NOT NULL AND t.ingested_at IS NOT NULL AND fr.scored_at >= t.ingested_at
          ), 0
        ) AS score_p95,
        COALESCE(
          (
            SELECT percentile_cont(0.95) WITHIN GROUP (
              ORDER BY EXTRACT(EPOCH FROM (a.created_at - t.ingested_at)) * 1000
            )
            FROM alerts a
            JOIN transactions t ON t.transaction_id = a.transaction_id
            WHERE a.created_at IS NOT NULL AND t.ingested_at IS NOT NULL AND a.created_at >= t.ingested_at
          ), 0
        ) AS alert_p95;
    `;

    // 4. Active Model and Latest Drift Status
    const modelSql = `
      SELECT
        mv.version,
        COALESCE(dr.status, 'OK') AS drift_status
      FROM model_versions mv
      LEFT JOIN LATERAL (
        SELECT status
        FROM drift_reports
        WHERE model_version = mv.version
        ORDER BY created_at DESC
        LIMIT 1
      ) dr ON true
      WHERE mv.status = 'ACTIVE'
      LIMIT 1;
    `;

    // 5. Streaming Heartbeat
    const heartbeatSql = `
      SELECT last_seen
      FROM service_heartbeats
      WHERE service = 'streaming'
      LIMIT 1;
    `;

    // Execute queries in parallel
    const [txRes, alertRes, latencyRes, modelRes, heartbeatRes] = await Promise.all([
      query(txSql),
      query(alertSql),
      query(latencySql),
      query(modelSql).catch(() => ({ rows: [] })),
      query(heartbeatSql).catch(() => ({ rows: [] })),
    ]);

    const txRow = (txRes && txRes.rows && txRes.rows[0]) || {};
    const alertRow = (alertRes && alertRes.rows && alertRes.rows[0]) || {};
    const latencyRow = (latencyRes && latencyRes.rows && latencyRes.rows[0]) || {};
    const modelRow = (modelRes && modelRes.rows && modelRes.rows[0]) || {};
    const heartbeatRow = heartbeatRes && heartbeatRes.rows && heartbeatRes.rows[0];

    // Compute streaming status (UP if last_seen within 60 seconds; allow small -5s clock skew)
    let streamingStatus = 'DOWN';
    if (heartbeatRow && heartbeatRow.last_seen) {
      const diffMs = Date.now() - new Date(heartbeatRow.last_seen).getTime();
      if (diffMs >= -5000 && diffMs <= 60000) {
        streamingStatus = 'UP';
      }
    }

    // Check ML service status
    const mlStatus = (await checkMlReadiness()) ? 'UP' : 'DOWN';

    // Check Kafka status
    const kafkaStatus = (typeof isProducerConnected === 'function' && isProducerConnected()) ? 'UP' : 'DOWN';

    res.json({
      total_transactions: Number(txRow.total_transactions || 0),
      flagged_transactions: Number(txRow.flagged_transactions || 0),
      legitimate: Number(txRow.legitimate || 0),
      suspicious: Number(txRow.suspicious || 0),
      high_risk: Number(txRow.high_risk || 0),
      pending: Number(txRow.pending || 0),
      total_alerts: Number(alertRow.total_alerts || 0),
      open_alerts: Number(alertRow.open_alerts || 0),
      new_alerts: Number(alertRow.new_alerts || 0),
      alerts_under_review: Number(alertRow.alerts_under_review || 0),
      resolved_alerts: Number(alertRow.resolved_alerts || 0),
      total_amount: Number(parseFloat(txRow.total_amount || 0).toFixed(2)),
      latency_ms: {
        score_p50: Math.round(Number(latencyRow.score_p50 || 0)),
        score_p95: Math.round(Number(latencyRow.score_p95 || 0)),
        alert_p95: Math.round(Number(latencyRow.alert_p95 || 0)),
      },
      active_model: {
        version: modelRow.version || 'v1',
        drift_status: modelRow.drift_status || 'OK',
      },
      system_status: {
        backend: 'UP',
        database: 'UP',
        kafka: kafkaStatus,
        ml_service: mlStatus,
        streaming: streamingStatus,
      },
      updated_at: new Date().toISOString(),
    });
  })
);

// GET /api/dashboard/trends - Minute-wise Transaction & Flagged Trends
router.get(
  '/trends',
  authenticate,
  asyncHandler(async (req, res) => {
    let minutes = 60;

    if (req.query.minutes !== undefined) {
      const parsed = Number(req.query.minutes);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new AppError(400, 'VALIDATION_ERROR', 'minutes must be a positive integer.');
      }
      minutes = parsed;
    }

    const bucketUnit = minutes > 180 ? 'hour' : 'minute';

    const trendsSql = `
      SELECT
        date_trunc('${bucketUnit}', t.tx_time) AS minute,
        COUNT(t.transaction_id)::int AS total,
        COUNT(*) FILTER (WHERE fr.risk_category IN ('SUSPICIOUS', 'HIGH_RISK') OR fr.is_anomaly = true)::int AS flagged
      FROM transactions t
      LEFT JOIN fraud_results fr
        ON fr.transaction_id = t.transaction_id
      WHERE t.tx_time >= (NOW() - ($1 * INTERVAL '1 minute'))
      GROUP BY date_trunc('${bucketUnit}', t.tx_time)
      ORDER BY minute ASC;
    `;

    const result = await query(trendsSql, [minutes]);

    const points = (result.rows || []).map((row) => ({
      minute: row.minute instanceof Date ? row.minute.toISOString() : new Date(row.minute).toISOString(),
      total: Number(row.total || 0),
      flagged: Number(row.flagged || 0),
    }));

    res.json({ points });
  })
);

module.exports = router;
