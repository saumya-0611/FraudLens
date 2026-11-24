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
const { query } = require('../config/db');
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

async function scoreTransactionInline(tx) {
  const ingestedAt = tx.ingested_at || new Date().toISOString();

  // 1. Load latest 50 prior transactions for account lookback
  const histRes = await query(
    `SELECT transaction_id, amount, tx_time
     FROM transactions
     WHERE account_ref = $1
     ORDER BY tx_time DESC
     LIMIT 50`,
    [String(tx.account_ref)]
  );

  const features = computeFeatures(tx, histRes.rows || []);

  // 2. Call ml-service /predict with X-Internal-Token
  const mlBase = (env.mlServiceUrl || 'http://localhost:8000').replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json' };
  if (env.internalMlToken) headers['X-Internal-Token'] = env.internalMlToken;

  let modelVersion = 'v1';
  let fraudProbability = 0.01;
  let anomalyScore = 0.0;
  let isAnomaly = false;
  let topReasons = [];

  try {
    const res = await fetch(`${mlBase}/predict`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        instances: [{ transaction_id: String(tx.transaction_id), features }],
      }),
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined,
    });
    if (res.ok) {
      const payload = await res.json();
      modelVersion = payload.model_version || 'v1';
      const pred = (payload.predictions || [])[0];
      if (pred) {
        fraudProbability = Number(pred.fraud_probability ?? 0.01);
        anomalyScore = Number(pred.anomaly_score ?? 0.0);
        isAnomaly = Boolean(pred.is_anomaly);
        topReasons = Array.isArray(pred.top_reasons) ? pred.top_reasons : [];
      }
    } else {
      console.error(`[InlineScorer] ML /predict returned HTTP ${res.status}`);
    }
  } catch (err) {
    console.error('[InlineScorer] ML /predict failed:', err.message);
  }

  const riskCategory = classifyRisk(fraudProbability, isAnomaly);

  // 3. Persist transaction + fraud_result idempotently
  await query(
    `INSERT INTO transactions (
       transaction_id, account_ref, amount, tx_time, category, merchant,
       lat, lon, merch_lat, merch_lon, customer_age, ingested_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (transaction_id) DO NOTHING`,
    [
      String(tx.transaction_id),
      String(tx.account_ref),
      Number(tx.amount),
      tx.tx_time,
      String(tx.category),
      tx.merchant || null,
      tx.lat ?? null,
      tx.lon ?? null,
      tx.merch_lat ?? null,
      tx.merch_lon ?? null,
      tx.customer_age ?? null,
      ingestedAt,
    ]
  );

  await query(
    `INSERT INTO fraud_results (
       transaction_id, fraud_probability, anomaly_score, is_anomaly,
       risk_category, top_reasons, features, model_version, scored_at
     ) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,NOW())
     ON CONFLICT (transaction_id) DO NOTHING`,
    [
      String(tx.transaction_id),
      fraudProbability,
      anomalyScore,
      isAnomaly,
      riskCategory,
      JSON.stringify(topReasons),
      JSON.stringify(features),
      modelVersion,
    ]
  );

  // 4. Create alert, append hash-chained audit row, and broadcast on HIGH_RISK
  if (riskCategory === 'HIGH_RISK') {
    const alertRes = await query(
      `INSERT INTO alerts (transaction_id, risk_score, state)
       VALUES ($1, $2, 'NEW')
       ON CONFLICT (transaction_id) DO NOTHING
       RETURNING alert_id, created_at`,
      [String(tx.transaction_id), fraudProbability]
    );
    const created = alertRes.rows && alertRes.rows[0];
    if (created) {
      const alertObj = sanitizeAlert({
        alert_id: created.alert_id,
        transaction_id: String(tx.transaction_id),
        account_masked: maskAccount(String(tx.account_ref)),
        amount: Number(tx.amount),
        category: String(tx.category),
        risk_score: fraudProbability,
        risk_category: riskCategory,
        top_reasons: topReasons,
        model_version: modelVersion,
        created_at: created.created_at instanceof Date
          ? created.created_at.toISOString()
          : new Date().toISOString(),
      });

      try {
        await audit({
          userId: null,
          username: 'system',
          action: 'ALERT_RAISED',
          entity: 'alert',
          entityId: String(created.alert_id),
          details: {
            transaction_id: alertObj.transaction_id,
            risk_score: alertObj.risk_score,
            risk_category: alertObj.risk_category,
            amount: alertObj.amount,
            category: alertObj.category,
          },
        });
      } catch (err) {
        console.error('[InlineScorer] Audit log failed:', err.message);
      }

      try {
        broadcastAlert(alertObj);
      } catch (err) {
        console.error('[InlineScorer] WebSocket broadcast warning:', err.message);
      }
    }
  }

  await touchStreamingHeartbeat();
}

module.exports = {
  scoreTransactionInline,
  computeFeatures,
  classifyRisk,
  startInlineHeartbeat,
  stopInlineHeartbeat,
};
