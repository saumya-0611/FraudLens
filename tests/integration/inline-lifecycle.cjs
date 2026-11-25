const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { createServer } = require('node:http');
const path = require('node:path');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { Pool } = require('../../backend/node_modules/pg');
const { WebSocket } = require('../../backend/node_modules/ws');

const backend = path.resolve(__dirname, '../../backend');
const dsn = new URL(process.env.FRAUDLENS_TEST_DATABASE_URL || 'postgres://invalid/');
assert.ok(
  dsn.protocol === 'postgres:' && dsn.hostname === '127.0.0.1' &&
  /^\/fraudlens_fixture(?:_[a-z0-9]+)?$/.test(dsn.pathname),
  'Set FRAUDLENS_TEST_DATABASE_URL to a disposable loopback fraudlens_fixture database.'
);

const pool = new Pool({ connectionString: dsn.href });
const fixtureId = randomUUID();
const adminPassword = 'Fixture-' + randomUUID();
const serviceToken = 'Fixture-' + randomUUID();
const internalToken = 'Fixture-' + randomUUID();
let mlAvailable = false;
let attempts = 0;
let scoredAmount;
let child;
let socket;

const ml = createServer(async (req, res) => {
  if (req.headers['x-internal-token'] !== internalToken) {
    res.writeHead(401).end();
    return;
  }
  if (req.url === '/ready') {
    res.writeHead(mlAvailable ? 200 : 503).end();
    return;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const { instances: [transaction] } = JSON.parse(Buffer.concat(chunks).toString());
  attempts += 1;
  if (!mlAvailable) {
    res.writeHead(503).end();
    return;
  }
  scoredAmount = transaction.features.amount;
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ model_version: 'integration-v1', predictions: [{
    transaction_id: transaction.transaction_id,
    fraud_probability: 0.94,
    anomaly_score: 0.2,
    is_anomaly: true,
    top_reasons: [],
  }] }));
});

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
}

async function until(check) {
  const end = Date.now() + 20_000;
  while (Date.now() < end) {
    const result = await check();
    if (result) return result;
    await delay(150);
  }
  throw new Error('Timed out waiting for the expected inline lifecycle state.');
}

async function stopBackend() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill();
  await exited;
}

async function main() {
  const mlPort = await listen(ml);
  const reserved = createServer();
  const backendPort = await listen(reserved);
  await new Promise(resolve => reserved.close(resolve));
  const base = `http://127.0.0.1:${backendPort}`;
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    DATABASE_URL: dsn.href,
    DATABASE_URL_UNPOOLED: dsn.href,
    DATABASE_SSL: 'false',
    PORT: String(backendPort),
    PIPELINE_MODE: 'inline',
    SOCIAL_OAUTH_ENABLED: 'false',
    COOKIE_SECURE: 'false',
    JWT_SECRET: 'Fixture-' + randomUUID(),
    SERVICE_TOKEN: serviceToken,
    INTERNAL_ML_TOKEN: internalToken,
    ML_SERVICE_URL: `http://127.0.0.1:${mlPort}`,
    WS_ALLOWED_ORIGINS: base,
    SEED_ADMIN_PASSWORD: adminPassword,
    SEED_ANALYST_PASSWORD: 'Fixture-' + randomUUID(),
    SEED_VIEWER_PASSWORD: 'Fixture-' + randomUUID(),
  };

  async function startBackend() {
    child = spawn(process.execPath, ['src/server.js'], { cwd: backend, env, stdio: 'inherit', windowsHide: true });
    await until(async () => (await fetch(base + '/health').catch(() => null))?.ok);
  }

  await startBackend();
  assert.equal((await fetch(base + '/ready')).status, 503);
  const seed = spawn(process.execPath, ['scripts/seed.js'], { cwd: backend, env, stdio: 'inherit', windowsHide: true });
  assert.equal((await once(seed, 'exit'))[0], 0);
  async function login(username, password) {
    const result = await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    assert.equal(result.status, 200);
    return result.headers.get('set-cookie').split(';')[0];
  }
  const admin = await login('admin', adminPassword);
  const analyst = await login('analyst', env.SEED_ANALYST_PASSWORD);
  const viewer = await login('viewer', env.SEED_VIEWER_PASSWORD);
  const transaction = {
    transaction_id: fixtureId,
    account_ref: 'synthetic-fixture-4321',
    amount: 42.25,
    tx_time: new Date().toISOString(),
    category: 'shopping_net',
  };
  const submit = async (amount, auth = { 'x-service-token': serviceToken }) => await fetch(base + '/api/transactions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth },
    body: JSON.stringify({ ...transaction, amount }),
  });
  const getResult = async () => await (await fetch(base + '/api/transactions/' + fixtureId, {
    headers: { cookie: admin },
  })).json();

  assert.equal((await submit(transaction.amount, {})).status, 401);
  assert.equal((await submit(transaction.amount, { cookie: analyst })).status, 403);
  assert.equal((await submit(transaction.amount, { cookie: viewer })).status, 403);
  assert.equal((await submit(-1)).status, 400);
  assert.equal((await fetch(base + '/api/transactions/' + fixtureId, { headers: { cookie: admin } })).status, 404);
  assert.equal((await fetch(base + '/api/alerts', { headers: { cookie: viewer } })).status, 403);
  const intake = await Promise.all([submit(transaction.amount), submit(transaction.amount, { cookie: admin })]);
  assert.deepEqual(intake.map(response => response.status), [202, 202]);
  assert.deepEqual(await intake[0].json(), { transaction_id: fixtureId, status: 'ACCEPTED' });
  const pending = await getResult();
  assert.equal(pending.risk_category, 'PENDING');
  assert.equal(pending.fraud_probability, null);
  assert.equal(pending.account_masked, 'XXXX-4321');
  assert.ok(!JSON.stringify(pending).includes(transaction.account_ref));
  await until(async () => {
    const { rows: [job] } = await pool.query(
      'SELECT attempts, lease_token FROM inline_scoring_jobs WHERE transaction_id = $1', [fixtureId]
    );
    return attempts > 0 && job?.attempts > 0 && job.lease_token === null;
  });

  await stopBackend();
  await startBackend();
  let ready = false;
  const alerts = [];
  socket = new WebSocket(`ws://127.0.0.1:${backendPort}/ws/alerts`, { headers: { Cookie: admin }, origin: base });
  socket.on('error', error => console.error(error.message));
  socket.on('message', data => {
    const message = JSON.parse(data);
    if (message.type === 'READY') ready = true;
    if (message.type === 'NEW_ALERT' && message.alert?.transaction_id === fixtureId) alerts.push(message.alert);
  });
  await until(() => ready);
  mlAvailable = true;
  assert.equal((await fetch(base + '/ready')).status, 200);
  const scored = await until(async () => {
    const result = await getResult();
    return result.risk_category === 'HIGH_RISK' && result;
  });
  assert.equal(scoredAmount, transaction.amount);
  assert.equal(scored.model_version, 'integration-v1');
  await until(() => alerts.length);
  assert.equal(alerts[0].account_masked, scored.account_masked);
  assert.equal((await submit(999)).status, 202);
  const { rows: [outcome] } = await pool.query(`
    SELECT t.amount::text,
      (SELECT count(*)::int FROM fraud_results WHERE transaction_id = t.transaction_id) AS scores,
      (SELECT count(*)::int FROM alerts WHERE transaction_id = t.transaction_id) AS alerts,
      (SELECT count(*)::int FROM audit_logs WHERE action = 'ALERT_RAISED'
       AND details->>'transaction_id' = t.transaction_id) AS audits
    FROM transactions t WHERE t.transaction_id = $1`, [fixtureId]);
  assert.deepEqual(outcome, { amount: '42.25', scores: 1, alerts: 1, audits: 1 });
  assert.equal(alerts.length, 1);

  const alertUrl = base + '/api/alerts/' + scored.alert.alert_id;
  const update = (cookie, payload) => fetch(alertUrl, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(payload),
  });
  assert.equal((await update(analyst, { state: 'UNDER_REVIEW' })).status, 200);
  const decisions = await Promise.all([
    update(admin, { state: 'RESOLVED', resolution: 'CONFIRMED_FRAUD' }),
    update(analyst, { state: 'RESOLVED', resolution: 'FALSE_POSITIVE' }),
  ]);
  assert.deepEqual(decisions.map(response => response.status).sort(), [200, 409]);
  console.log('Inline lifecycle passed: role matrix, durable intake, outage, restart recovery, replay, atomic audit and alert delivery.');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  socket?.terminate();
  await stopBackend();
  ml.close();
  await pool.end();
});
