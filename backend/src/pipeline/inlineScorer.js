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
const { pool, query } = require('../config/db');
const { appendAudit } = require('../audit/auditLogger');
const { broadcastAlert } = require('../websocket/alertSocket');
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

function startInlineHeartbeat() {
  if (heartbeatTimer) return;
  touchStreamingHeartbeat();
  heartbeatTimer = setInterval(touchStreamingHeartbeat, 25000);
  if (typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref();
}

function stopInlineHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

async function acceptTransactionInline(tx) {
  await query(
    `INSERT INTO transactions (
       transaction_id, account_ref, amount, tx_time, category, merchant,
       lat, lon, merch_lat, merch_lon, customer_age, ingested_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (transaction_id) DO NOTHING`,
    [
      tx.transaction_id, tx.account_ref, tx.amount, tx.tx_time, tx.category, tx.merchant || null,
      tx.lat ?? null, tx.lon ?? null, tx.merch_lat ?? null, tx.merch_lon ?? null,
      tx.customer_age ?? null, tx.ingested_at,
    ]
  );
}

async function predict(transactionId, features) {
  const mlBase = env.mlServiceUrl.replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json' };
  if (env.internalMlToken) headers['X-Internal-Token'] = env.internalMlToken;
  const response = await fetch(`${mlBase}/predict`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ instances: [{ transaction_id: transactionId, features }] }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('ML returned an unsuccessful response.');

  const payload = await response.json();
  const modelVersion = payload?.model_version;
  const predictions = payload?.predictions;
  const result = Array.isArray(predictions) && predictions.length === 1 ? predictions[0] : undefined;
  if (typeof modelVersion !== 'string' || !modelVersion.trim() || modelVersion.length > 30 ||
      result?.transaction_id !== transactionId ||
      !Number.isFinite(result.fraud_probability) || result.fraud_probability < 0 || result.fraud_probability > 1 ||
      !Number.isFinite(result.anomaly_score) || typeof result.is_anomaly !== 'boolean' ||
      !Array.isArray(result.top_reasons) || !result.top_reasons.every((reason) =>
        reason && typeof reason.feature === 'string' && typeof reason.text === 'string' && Number.isFinite(reason.impact))) {
    throw new Error('ML returned an invalid prediction.');
  }
  return { ...result, model_version: modelVersion };
}

async function persistScore(tx, features, prediction) {
  const { fraud_probability, anomaly_score, is_anomaly, top_reasons, model_version } = prediction;
  const category = classifyRisk(fraud_probability, is_anomaly);
  const client = await pool.connect();
  let discard;
  try {
    await client.query('BEGIN');
    const { rows: [score] } = await client.query(
      `INSERT INTO fraud_results (
         transaction_id, fraud_probability, anomaly_score, is_anomaly, risk_category,
         top_reasons, features, model_version
       ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8)
       ON CONFLICT (transaction_id) DO NOTHING
       RETURNING fraud_probability, risk_category`,
      [tx.transaction_id, fraud_probability, anomaly_score, is_anomaly, category,
        JSON.stringify(top_reasons), JSON.stringify(features), model_version]
    );

    let alert;
    if (score?.risk_category === 'HIGH_RISK') {
      const { rows: [created] } = await client.query(
        `INSERT INTO alerts (transaction_id, risk_score, state)
         VALUES ($1, $2, 'NEW')
         ON CONFLICT (transaction_id) DO NOTHING
         RETURNING alert_id, created_at`,
        [tx.transaction_id, score.fraud_probability]
      );
      if (created) {
        alert = {
          alert_id: created.alert_id,
          transaction_id: tx.transaction_id,
          account_masked: maskAccount(tx.account_ref),
          amount: Number(tx.amount),
          category: tx.category,
          risk_score: score.fraud_probability,
          risk_category: score.risk_category,
          top_reasons,
          model_version,
          created_at: created.created_at.toISOString(),
        };
        await appendAudit(client, {
          action: 'ALERT_RAISED', entity: 'alert', entityId: String(alert.alert_id),
          details: {
            transaction_id: alert.transaction_id, risk_score: alert.risk_score,
            risk_category: alert.risk_category, amount: alert.amount, category: alert.category,
          },
        });
      }
    }

    await client.query('COMMIT');
    return alert;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      discard = rollbackError;
    }
    throw error;
  } finally {
    client.release(discard);
  }
}

async function scoreTransactionInline(transactionId) {
  const { rows: [tx] } = await query(
    `SELECT t.*, EXISTS (SELECT 1 FROM fraud_results WHERE transaction_id = t.transaction_id) AS scored
     FROM transactions t WHERE t.transaction_id = $1`,
    [transactionId]
  );
  if (!tx || tx.scored) return;

  // Replays always use the first accepted payload stored under this transaction ID.
  const { rows: history } = await query(
    `SELECT transaction_id, amount, tx_time FROM transactions
     WHERE account_ref = $1 AND transaction_id <> $2 AND tx_time <= $3
     ORDER BY tx_time DESC LIMIT 50`,
    [tx.account_ref, tx.transaction_id, tx.tx_time]
  );
  const features = computeFeatures(tx, history);

  let prediction;
  try {
    prediction = await predict(transactionId, features);
  } catch {
    console.warn('[InlineScorer] Inference did not complete. Transaction remains unscored unless another attempt commits.');
    return;
  }

  const alert = await persistScore(tx, features, prediction);
  if (alert) {
    try {
      await broadcastAlert(alert);
    } catch (error) {
      console.warn('[InlineScorer] WebSocket broadcast warning:', error.message);
    }
  }
  await touchStreamingHeartbeat();
}

module.exports = {
  acceptTransactionInline,
  scoreTransactionInline,
  computeFeatures,
  classifyRisk,
  startInlineHeartbeat,
  stopInlineHeartbeat,
};
