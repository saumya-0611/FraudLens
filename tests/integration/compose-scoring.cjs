// Run via docker compose exec with node reading this file on stdin.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { WebSocket } = require('ws');

const backend = 'http://127.0.0.1:5000';
const ml = 'http://ml-service:8000';
const dsn = new URL(process.env.DATABASE_URL || 'postgresql://invalid/');
assert.ok(
  process.env.FRAUDLENS_COMPOSE_SMOKE === '1' &&
  dsn.hostname === 'postgres' && dsn.pathname === '/fraudlens_ci' &&
  process.env.ML_SERVICE_URL === ml,
  'Run this smoke test only in the disposable Compose CI stack.'
);

const { computeFeatures, classifyRisk } = require('./src/pipeline/inlineScorer');
const headers = { 'Content-Type': 'application/json' };
const prefix = 'ci-' + randomUUID();

async function until(check) {
  const end = Date.now() + 60_000;
  while (Date.now() < end) {
    const value = await check();
    if (value) return value;
    await delay(350);
  }
  throw new Error('Timed out waiting for scoring, alert audit, or WebSocket delivery.');
}

async function samples() {
  const candidates = [500, 900, 1500, 3000, 8000].flatMap((amount) =>
    ['shopping_net', 'misc_net', 'grocery_pos'].map((category) => ({
      transaction_id: prefix + '-' + amount + '-' + category,
      account_ref: 'fixture-' + prefix + '-7890',
      amount,
      category,
      tx_time: '2026-11-25T02:15:00Z',
      lat: 40,
      lon: -74,
      merch_lat: 46,
      merch_lon: -80,
      customer_age: 42,
    }))
  );
  const response = await fetch(ml + '/predict', {
    method: 'POST',
    headers: { ...headers, 'X-Internal-Token': process.env.INTERNAL_ML_TOKEN },
    body: JSON.stringify({ instances: candidates.map((tx) => ({
      transaction_id: tx.transaction_id,
      features: computeFeatures(tx, []),
    })) }),
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(response.status, 200);
  const { model_version: version, predictions } = await response.json();
  const highRisk = predictions.find((item) => classifyRisk(item.fraud_probability, item.is_anomaly) === 'HIGH_RISK');
  assert.ok(highRisk, 'The loaded model should score at least one synthetic candidate as high risk.');
  const tx = candidates.find((item) => item.transaction_id === highRisk.transaction_id);
  assert.ok(tx);
  return { tx, version };
}

async function main() {
  const login = await fetch(backend + '/api/auth/login', {
    method: 'POST',
    headers,
    body: JSON.stringify({ username: 'admin', password: process.env.SEED_ADMIN_PASSWORD }),
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const { tx, version } = await samples();

  const socket = new WebSocket('ws://127.0.0.1:5000/ws/alerts', {
    headers: { Cookie: cookie },
    origin: backend,
  });
  let ready = false;
  let liveAlert;
  let socketError;
  socket.on('error', (error) => { socketError = error; });
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString());
    if (message.type === 'READY') ready = true;
    if (message.type === 'NEW_ALERT' && message.alert?.transaction_id === tx.transaction_id) {
      liveAlert = message.alert;
    }
  });
  try {
    await until(() => {
      if (socketError) throw socketError;
      return ready;
    });
    const accepted = await fetch(backend + '/api/transactions', {
      method: 'POST',
      headers: { ...headers, 'X-Service-Token': process.env.SERVICE_TOKEN },
      body: JSON.stringify(tx),
      signal: AbortSignal.timeout(5_000),
    });
    assert.equal(accepted.status, 202);
    assert.equal((await accepted.json()).transaction_id, tx.transaction_id);

    const stored = await until(async () => {
      const response = await fetch(backend + '/api/transactions/' + encodeURIComponent(tx.transaction_id), {
        headers: { Cookie: cookie },
        signal: AbortSignal.timeout(5_000),
      });
      if (response.status === 404) return false;
      assert.equal(response.status, 200);
      const transaction = await response.json();
      return transaction.risk_category === 'PENDING' ? false : transaction;
    });
    assert.equal(stored.risk_category, 'HIGH_RISK');
    assert.equal(stored.model_version, version);
    assert.equal(stored.account_masked, 'XXXX-7890');
    assert.equal(stored.amount, tx.amount);
    assert.ok(stored.alert?.alert_id);

    const alert = await until(() => {
      if (socketError) throw socketError;
      return liveAlert;
    });
    assert.equal(String(alert.alert_id), String(stored.alert.alert_id));
    assert.equal(alert.account_masked, stored.account_masked);

    await until(async () => {
      const response = await fetch(backend + '/api/audit-logs?action=ALERT_RAISED&include_hash=true', {
        headers: { Cookie: cookie },
        signal: AbortSignal.timeout(5_000),
      });
      assert.equal(response.status, 200);
      const { items } = await response.json();
      return items.some((item) => String(item.entity_id) === String(stored.alert.alert_id) && item.entry_hash);
    });
    console.log('Compose scoring smoke passed: real prediction, persisted result, audited alert, WebSocket delivery.');
  } finally {
    socket.terminate();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
