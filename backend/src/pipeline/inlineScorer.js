/**
 * inlineScorer.js - Cloud/Render Free-Tier inline scoring pipeline (PIPELINE_MODE=inline).
 *
 * When deployed on Render Free Tier without an external Kafka broker or paid worker,
 * computes the exact same 13 CONTRACTS §5 features using the 50-row PostgreSQL lookback,
 * scores via ml-service POST /predict (with X-Internal-Token), classifies using
 * CONTRACTS §7 thresholds (high=0.80, low=0.40), persists transactions + fraud_results + alerts,
 * writes the hash-chained ALERT_RAISED audit row, and broadcasts over /ws/alerts.
 */
const env = require('../config/env');
const { query, withTransaction } = require('../config/db');
const { audit } = require('../audit/auditLogger');
const { broadcastAlert, sanitizeAlert } = require('../websocket/alertSocket');
const { maskAccount } = require('../utils/mask');

const CATEGORY_MAP = {
  entertainment: 0,
  food_dining: 1,
  gas_transport: 2,
  grocery_net: 3,
  grocery_pos: 4,
  health_fitness: 5,
  home: 6,
  kids_pets: 7,
  misc_net: 8,
  misc_pos: 9,
  personal_care: 10,
  shopping_net: 11,
  shopping_pos: 12,
  travel: 13,
};

const HIGH_THRESHOLD = 0.80;
const LOW_THRESHOLD = 0.40;
const NO_PREVIOUS_TX_SECS = 604800;
const AVG_WINDOW = 30;
const EARTH_RADIUS_KM = 6371.0088;

function haversineKm(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some((v) => v === null || v === undefined || !Number.isFinite(Number(v)))) {
    return -1;
  }
  const toRad = (deg) => (Number(deg) * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
}

function classifyRisk(prob, isAnomaly) {
  if (prob >= HIGH_THRESHOLD || (prob >= LOW_THRESHOLD && isAnomaly)) {
    return 'HIGH_RISK';
  }
  if (prob >= LOW_THRESHOLD || isAnomaly) {
    return 'SUSPICIOUS';
  }
  return 'LEGITIMATE';
}

function computeFeatures(tx, historyRows) {
  const amount = Number(tx.amount || 0);
  const txDate = new Date(tx.tx_time || Date.now());
  const txMs = txDate.getTime();
  const hour = txDate.getUTCHours();
  const dayOfWeek = (txDate.getUTCDay() + 6) % 7; // Python pandas dayofweek: Mon=0..Sun=6
  const isNight = hour < 6 || hour >= 22 ? 1 : 0;
  const categoryCode = Object.prototype.hasOwnProperty.call(CATEGORY_MAP, String(tx.category || ''))
    ? CATEGORY_MAP[String(tx.category)]
    : -1;
  const distanceKm = haversineKm(tx.lat, tx.lon, tx.merch_lat, tx.merch_lon);
  const customerAge = tx.customer_age === null || tx.customer_age === undefined ? -1 : Number(tx.customer_age);

  const prior = (historyRows || [])
    .filter((r) => String(r.transaction_id) !== String(tx.transaction_id))
    .map((r) => ({ ms: new Date(r.tx_time).getTime(), amount: Number(r.amount || 0) }))
    .filter((r) => Number.isFinite(r.ms) && r.ms <= txMs)
    .sort((a, b) => a.ms - b.ms);

  const oneHourAgo = txMs - 3600 * 1000;
  const oneDayAgo = txMs - 24 * 3600 * 1000;
  let txCount1h = 0;
  let txCount24h = 0;
  for (const r of prior) {
    if (r.ms >= oneDayAgo) txCount24h += 1;
    if (r.ms >= oneHourAgo) txCount1h += 1;
  }

  const secsSinceLastTx = prior.length > 0
    ? Math.max(0, (txMs - prior[prior.length - 1].ms) / 1000)
    : NO_PREVIOUS_TX_SECS;

  const recentForAvg = prior.slice(-AVG_WINDOW);
  const avgAmountPrior = recentForAvg.length > 0
    ? recentForAvg.reduce((sum, r) => sum + r.amount, 0) / recentForAvg.length
    : amount;

  const amountRatio = amount / Math.max(avgAmountPrior, 1.0);

  return {
    amount: Number(amount.toFixed(2)),
    log_amount: Number(Math.log1p(Math.max(0, amount)).toFixed(6)),
    hour,
    day_of_week: dayOfWeek,
    is_night: isNight,
    category_code: categoryCode,
    distance_km: Number(distanceKm.toFixed(4)),
    customer_age: customerAge,
    tx_count_1h: txCount1h,
    tx_count_24h: txCount24h,
    secs_since_last_tx: Number(secsSinceLastTx.toFixed(2)),
    avg_amount_prior: Number(avgAmountPrior.toFixed(2)),
    amount_ratio: Number(amountRatio.toFixed(4)),
  };
}

async function touchStreamingHeartbeat() {
  try {
    await query(
      `INSERT INTO service_heartbeats (service, last_seen)
       VALUES ('streaming', NOW())
       ON CONFLICT (service) DO UPDATE SET last_seen = EXCLUDED.last_seen`
    );
  } catch (err) {
    console.warn('[InlineScorer] Heartbeat update warning:', err.message);
  }
}

let heartbeatTimer = null;
let recoveryRunning = false;

async function recoverPendingTransactions() {
  if (recoveryRunning) return;
  recoveryRunning = true;
  try {
    const pending = await query(
      `SELECT t.${TRANSACTION_COLUMNS.split(',').join(', t.')}
       FROM transactions t
       LEFT JOIN fraud_results fr ON fr.transaction_id = t.transaction_id
       WHERE fr.transaction_id IS NULL
       ORDER BY t.ingested_at ASC
       LIMIT 10`
    );
    await Promise.allSettled((pending.rows || []).map((transaction) => scoreTransactionInline(transaction)));
  } catch (error) {
    console.warn('[InlineScorer] Pending recovery warning:', error.message);
  } finally {
    recoveryRunning = false;
  }
}

function startInlineHeartbeat() {
  if (heartbeatTimer) return;
  touchStreamingHeartbeat();
  void recoverPendingTransactions();
  heartbeatTimer = setInterval(() => {
    touchStreamingHeartbeat();
    void recoverPendingTransactions();
  }, 25000);
  if (typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref();
}

function stopInlineHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

const TRANSACTION_COLUMNS = `transaction_id, account_ref, amount, tx_time, category, merchant,
  lat, lon, merch_lat, merch_lon, customer_age, ingested_at`;

async function persistPendingTransaction(tx) {
  await query(
    `INSERT INTO transactions (${TRANSACTION_COLUMNS})
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (transaction_id) DO NOTHING`,
    [
      String(tx.transaction_id), String(tx.account_ref), Number(tx.amount), tx.tx_time,
      String(tx.category), tx.merchant || null, tx.lat ?? null, tx.lon ?? null,
      tx.merch_lat ?? null, tx.merch_lon ?? null, tx.customer_age ?? null,
      tx.ingested_at || new Date().toISOString(),
    ]
  );
}

function parsePrediction(payload, transactionId) {
  if (!payload || typeof payload.model_version !== 'string' || !payload.model_version.trim() ||
      payload.model_version.length > 30 || !Array.isArray(payload.predictions) ||
      payload.predictions.length !== 1) return null;
  const prediction = payload.predictions[0];
  if (!prediction || prediction.transaction_id !== transactionId ||
      typeof prediction.is_anomaly !== 'boolean' ||
      !Number.isFinite(prediction.fraud_probability) ||
      prediction.fraud_probability < 0 || prediction.fraud_probability > 1 ||
      !Number.isFinite(prediction.anomaly_score) ||
      prediction.anomaly_score < 0 || prediction.anomaly_score > 1 ||
      !Array.isArray(prediction.top_reasons) ||
      prediction.top_reasons.some((reason) => !reason ||
        typeof reason.feature !== 'string' || typeof reason.text !== 'string' ||
        !Number.isFinite(reason.impact))) return null;
  return { ...prediction, model_version: payload.model_version };
}

async function requestPrediction(tx, client) {
  const histRes = await client.query(
    `SELECT transaction_id, amount, tx_time
     FROM transactions WHERE account_ref = $1
     ORDER BY tx_time DESC LIMIT 50`,
    [String(tx.account_ref)]
  );
  const features = computeFeatures(tx, histRes.rows || []);
  const mlBase = (env.mlServiceUrl || 'http://localhost:8000').replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json' };
  if (env.internalMlToken) headers['X-Internal-Token'] = env.internalMlToken;

  try {
    const response = await fetch(`${mlBase}/predict`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ instances: [{ transaction_id: String(tx.transaction_id), features }] }),
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout
        ? AbortSignal.timeout(15000)
        : undefined,
    });
    if (!response.ok) {
      console.error(`[InlineScorer] ML /predict returned HTTP ${response.status}`);
      return null;
    }
    const prediction = parsePrediction(await response.json(), String(tx.transaction_id));
    return prediction ? { prediction, features } : null;
  } catch (error) {
    console.error('[InlineScorer] ML /predict failed:', error.message);
    return null;
  }
}

async function scoreTransactionInline(tx) {
  const transactionId = String(tx.transaction_id);
  const outcome = await withTransaction(async (client) => {
    const stored = await client.query(
      `SELECT ${TRANSACTION_COLUMNS} FROM transactions
       WHERE transaction_id = $1 FOR UPDATE`,
      [transactionId]
    );
    const transaction = stored.rows?.[0];
    if (!transaction) throw new Error(`Pending transaction ${transactionId} was not persisted`);

    const priorResult = await client.query(
      `SELECT fraud_probability, anomaly_score, is_anomaly, risk_category,
              top_reasons, features, model_version, scored_at
       FROM fraud_results WHERE transaction_id = $1`,
      [transactionId]
    );
    if (priorResult.rows?.[0]) return { alreadyScored: true };

    const predictionResult = await requestPrediction(transaction, client);
    if (!predictionResult) return { pending: true };
    const { prediction, features } = predictionResult;

    const riskCategory = classifyRisk(prediction.fraud_probability, prediction.is_anomaly);
    const inserted = await client.query(
      `INSERT INTO fraud_results (
         transaction_id, fraud_probability, anomaly_score, is_anomaly,
         risk_category, top_reasons, features, model_version, scored_at
       ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,NOW())
       ON CONFLICT (transaction_id) DO NOTHING
       RETURNING transaction_id`,
      [transactionId, prediction.fraud_probability, prediction.anomaly_score,
        prediction.is_anomaly, riskCategory, JSON.stringify(prediction.top_reasons),
        JSON.stringify(features), prediction.model_version]
    );
    if (!inserted.rows?.[0]) return { alreadyScored: true };

    let alert = null;
    if (riskCategory === 'HIGH_RISK') {
      const alertRes = await client.query(
        `INSERT INTO alerts (transaction_id, risk_score, state)
         VALUES ($1, $2, 'NEW')
         ON CONFLICT (transaction_id) DO NOTHING
         RETURNING alert_id, created_at`,
        [transactionId, prediction.fraud_probability]
      );
      const created = alertRes.rows?.[0];
      if (created) {
        alert = sanitizeAlert({
          alert_id: created.alert_id,
          transaction_id: transactionId,
          account_masked: maskAccount(String(transaction.account_ref)),
          amount: Number(transaction.amount),
          category: String(transaction.category),
          risk_score: prediction.fraud_probability,
          risk_category: riskCategory,
          top_reasons: prediction.top_reasons,
          model_version: prediction.model_version,
          created_at: created.created_at instanceof Date
            ? created.created_at.toISOString()
            : new Date(created.created_at).toISOString(),
        });
      }
    }
    return { scored: true, alert };
  });

  if (outcome?.alert) {
    try {
      await audit({
        userId: null,
        username: 'system',
        action: 'ALERT_RAISED',
        entity: 'alert',
        entityId: String(outcome.alert.alert_id),
        details: {
          transaction_id: outcome.alert.transaction_id,
          risk_score: outcome.alert.risk_score,
          risk_category: outcome.alert.risk_category,
          amount: outcome.alert.amount,
          category: outcome.alert.category,
        },
      });
    } catch (error) {
      console.error('[InlineScorer] Audit log failed:', error.message);
    }
    try {
      await broadcastAlert(outcome.alert);
    } catch (error) {
      console.error('[InlineScorer] WebSocket broadcast warning:', error.message);
    }
  }

  if (outcome?.scored) await touchStreamingHeartbeat();
  return outcome;
}

module.exports = {
  scoreTransactionInline,
  persistPendingTransaction,
  parsePrediction,
  recoverPendingTransactions,
  computeFeatures,
  classifyRisk,
  startInlineHeartbeat,
  stopInlineHeartbeat,
};
