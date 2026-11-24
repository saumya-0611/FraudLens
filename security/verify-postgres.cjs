const assert = require('node:assert/strict');
const http = require('node:http');
const { randomBytes } = require('node:crypto');
const { execFile, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { promisify } = require('node:util');
const { createRequire } = require('node:module');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const backend = path.resolve(__dirname, '../backend');
const backendRequire = createRequire(path.join(backend, 'package.json'));
const database = new URL(process.env.DATABASE_URL || '');
assert.equal(database.hostname, '127.0.0.1');
assert.match(database.pathname, /^\/fraudlens_phase2_verification(?:_[a-f0-9]{16})?$/);
assert(database.port && !database.search && !database.hash, 'Use an explicit disposable port and a URL without options.');
process.env.DATABASE_URL_UNPOOLED = process.env.DATABASE_URL;
assert.equal(database.protocol, 'postgresql:');

process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.SERVICE_TOKEN = randomBytes(32).toString('hex');
process.env.JWT_EXPIRES_IN = '2h';
process.env.COOKIE_SECURE = 'false';
process.env.NODE_ENV = 'development';
for (const name of ['ADMIN', 'ANALYST', 'VIEWER']) {
  process.env['SEED_' + name + '_PASSWORD'] = randomBytes(20).toString('hex');
}

const request = backendRequire('supertest');
const WebSocket = backendRequire('ws');
const bcrypt = backendRequire('bcryptjs');
const { signToken } = backendRequire('./src/utils/jwt');
let server;
let mlServer;
let pool;
let closeAlertSocket;
function runScript(script, extraEnv = {}) {
  const run = spawnSync(process.execPath, [script], {
    cwd: backend, encoding: 'utf8', env: { ...process.env, ...extraEnv },
  });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.trim();
}

async function main() {
  const mlToken = randomBytes(32).toString('hex');
  const receivedPredictions = new Set();
  const fixtureAccount = 'synthetic-account-4321';
  mlServer = http.createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== '/predict' || req.headers['x-internal-token'] !== mlToken) {
      res.writeHead(403).end();
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const { instances } = JSON.parse(Buffer.concat(chunks));
    for (const { transaction_id } of instances) receivedPredictions.add(transaction_id);
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
      model_version: 'fixture-v1',
      predictions: instances.map(({ transaction_id }) => ({
        transaction_id, fraud_probability: 0.99, anomaly_score: 0.85, is_anomaly: true,
        top_reasons: [{ feature: 'amount', text: 'Fixture amount', impact: 1, metadata: { account_ref: fixtureAccount, weight: 1 } }],
      })),
    }));
  });
  mlServer.listen(0, '127.0.0.1');
  await once(mlServer, 'listening');
  process.env.PIPELINE_MODE = 'inline';
  process.env.ML_SERVICE_URL = 'http://127.0.0.1:' + mlServer.address().port;
  process.env.INTERNAL_ML_TOKEN = mlToken;

  const app = backendRequire('./src/app');
  const { audit, GENESIS_HASH } = backendRequire('./src/audit/auditLogger');
  const { firstMismatch } = backendRequire('./scripts/verify_audit_chain');
  const { query, pool: runtimePool } = backendRequire('./src/config/db');
  const socketApi = backendRequire('./src/websocket/alertSocket');
  pool = runtimePool;
  closeAlertSocket = socketApi.closeAlertSocket;
  server = http.createServer(app);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  process.env.WS_ALLOWED_ORIGINS = origin;
  socketApi.initAlertSocket(server);
  const wsUrl = 'ws://127.0.0.1:' + server.address().port + '/ws/alerts';

  if (process.env.FRAUDLENS_TASK02_PROBES === 'true') {
    await promisify(execFile)(process.execPath, [path.join(__dirname, '../scripts/test_app_live.js')], {
      env: { ...process.env, FRAUDLENS_PROOF_ORIGIN: origin }, timeout: 15000,
    });
    console.log('PASS: anonymous HTTP proof against the real disposable backend');
  }

  const { rows: [initial] } = await query(
    'SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM audit_logs) AS audits'
  );
  assert.deepEqual(initial, { users: '0', audits: '0' }, 'Use an empty disposable database.');
  runScript('scripts/seed.js');
  const seedRows = (await query('SELECT username, role, password_hash FROM users ORDER BY id')).rows;
  assert.deepEqual(seedRows.map(({ role }) => role), ['ADMIN', 'ANALYST', 'VIEWER']);
  assert(await bcrypt.compare(process.env.SEED_ADMIN_PASSWORD, seedRows[0].password_hash));
  runScript('scripts/seed.js', { SEED_ADMIN_PASSWORD: '', SEED_ANALYST_PASSWORD: '', SEED_VIEWER_PASSWORD: '' });
  assert.deepEqual((await query('SELECT username, role, password_hash FROM users ORDER BY id')).rows, seedRows);
  console.log('PASS: three bcrypt seed users and idempotent reseed');

  const admin = request.agent(server);
  const viewer = request.agent(server);
  const login = (agent, username, password) => agent.post('/api/auth/login').send({ username, password });
  const failed = await Promise.all(Array.from({ length: 5 }, () => login(admin, 'admin', 'incorrect-fixture')));
  assert(failed.every((res) => res.status === 401 && res.body.error.code === 'INVALID_CREDENTIALS'));
  const lock = (await query("SELECT failed_attempts, locked_until FROM users WHERE username = 'admin'")).rows[0];
  assert.equal(lock.failed_attempts, 5);
  const remaining = lock.locked_until.getTime() - Date.now();
  assert(remaining > 14 * 60_000 && remaining <= 15 * 60_000);
  assert.equal((await login(admin, 'admin', process.env.SEED_ADMIN_PASSWORD)).status, 401);
  await query("UPDATE users SET locked_until = now() - interval '1 second' WHERE username = 'admin'");
  assert.equal((await login(admin, 'admin', process.env.SEED_ADMIN_PASSWORD)).status, 200);
  const reset = (await query("SELECT failed_attempts, locked_until FROM users WHERE username = 'admin'")).rows[0];
  assert.deepEqual(reset, { failed_attempts: 0, locked_until: null });
  assert.equal((await admin.get('/api/auth/me')).body.role, 'ADMIN');
  const signedInViewer = await login(viewer, 'viewer', process.env.SEED_VIEWER_PASSWORD);
  assert.equal(signedInViewer.status, 200);
  assert.equal((await viewer.get('/api/users')).status, 403);
  console.log('PASS: five concurrent failed logins, 15-minute lock, expiry recovery, role denial');

  const analyst = request.agent(server);
  assert.equal((await login(analyst, 'analyst', process.env.SEED_ANALYST_PASSWORD)).status, 200);
  const anonymous = request(server);
  const unknown = await login(anonymous, 'unknown-fixture', 'incorrect-fixture');
  assert.equal(unknown.status, 401);
  assert.equal(unknown.body.error.code, failed[0].body.error.code);
  assert.equal(unknown.body.error.message, failed[0].body.error.message);
  assert.equal((await login(anonymous, 'unknown-fixture', 'incorrect-fixture')).status, 429);
  const fixtureId = 'runtime-check-admin';
  const payload = {
    transaction_id: fixtureId, account_ref: fixtureAccount, amount: 19.95,
    tx_time: new Date().toISOString(), category: 'retail',
  };
  for (const route of ['/api/transactions', '/api/transactions/' + fixtureId, '/api/alerts']) {
    assert.equal((await anonymous.get(route)).status, 401);
  }
  assert.equal((await anonymous.post('/api/transactions').send(payload)).status, 401);
  const rejectedPayload = { ...payload, transaction_id: 'runtime-check-denied' };
  for (const agent of [viewer, analyst]) {
    assert.equal((await agent.post('/api/transactions').send(rejectedPayload)).status, 403);
  }
  assert.equal((await anonymous.post('/api/transactions')
    .set('X-Service-Token', 'incorrect-fixture').send(rejectedPayload)).status, 401);
  assert.equal((await viewer.get('/api/alerts')).status, 403);
  for (const agent of [viewer, analyst]) {
    assert.equal((await agent.get('/api/users')).status, 403);
    assert.equal((await agent.post('/api/models/retrain').send({})).status, 403);
  }

  const viewerId = (await query("SELECT id FROM users WHERE username = 'viewer'")).rows[0].id;
  const cookie = signedInViewer.headers['set-cookie'][0].split(';', 1)[0];
  const [head, body, signature] = cookie.split('.');
  const changedSignature = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);
  assert.equal((await anonymous.get('/api/auth/me').set('Cookie', [head, body, changedSignature].join('.'))).status, 401);
  process.env.JWT_EXPIRES_IN = '-1s';
  const expiredToken = signToken({ id: viewerId, username: 'viewer', role: 'VIEWER' });
  process.env.JWT_EXPIRES_IN = '2h';
  assert.equal((await anonymous.get('/api/auth/me').set('Cookie', 'fl_token=' + expiredToken)).status, 401);
  for (const filter of ['q[unexpected]=fixture', 'risk=unknown-fixture', 'from=invalid-date']) {
    const malformed = await viewer.get('/api/transactions').query(filter);
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.error.code, 'VALIDATION_ERROR');
  }
  for (const [body, expected] of [['{', 400], [JSON.stringify({ data: 'x'.repeat(101 * 1024) }), 413]]) {
    const response = await admin.post('/api/transactions').type('json').send(body);
    assert.equal(response.status, expected);
    assert.equal(response.body.error.request_id, response.headers['x-request-id']);
    assert(!Object.hasOwn(response.body.error, 'stack'));
  }
  console.log('PASS: anonymous and role denials, invalid service token, signature integrity, expired session, invalid SQL filter shapes, and parser limits');
  console.log('PASS: generic login errors and HTTP 429 after the request quota');
  assert.equal((await once(new WebSocket(wsUrl, { origin }), 'close'))[0], 4401);
  const foreign = new WebSocket(wsUrl, { origin: 'https://foreign.example.test', headers: { cookie } });
  const [, rejectedUpgrade] = await once(foreign, 'unexpected-response');
  rejectedUpgrade.resume();
  assert.equal(rejectedUpgrade.statusCode, 403);
  const socket = new WebSocket(wsUrl, { origin, headers: { cookie } });
  await once(socket, 'open');
  const messages = [];
  socket.on('message', (data) => messages.push(JSON.parse(data)));

  const servicePayload = { ...payload, transaction_id: 'runtime-check-service' };
  const submissions = [
    await admin.post('/api/transactions').send(payload),
    await anonymous.post('/api/transactions').set('X-Service-Token', process.env.SERVICE_TOKEN).send(servicePayload),
  ];
  for (const [index, response] of submissions.entries()) {
    assert.equal(response.status, 202);
    assert.deepEqual(response.body, { transaction_id: [fixtureId, servicePayload.transaction_id][index], status: 'ACCEPTED' });
  }

  for (let i = 0; i < 100 && messages.length < 2; i++) await delay(50);
  assert.equal(messages.length, 2, 'Expected two persisted fixture alerts over the real socket.');
  assert.deepEqual(receivedPredictions, new Set([fixtureId, servicePayload.transaction_id]));
  assert.equal((await query('SELECT count(*) FROM transactions WHERE transaction_id = $1',
    [rejectedPayload.transaction_id])).rows[0].count, '0');
  for (const message of messages) {
    assert.equal(message.type, 'NEW_ALERT');
    assert.equal(message.alert.account_masked, 'XXXX-4321');
    assert.equal(message.alert.top_reasons[0].metadata.weight, 1);
    assert(!JSON.stringify(message).includes('account_ref'));
    assert(!JSON.stringify(message).includes(fixtureAccount));
  }
  for (const term of ['XXXX-4321', fixtureId]) {
    const result = await viewer.get('/api/transactions').query({ q: term });
    assert.equal(result.status, 200);
    assert.equal(result.body.total, term === fixtureId ? 1 : 2);
    assert(result.body.items.every((item) => item.account_masked === 'XXXX-4321'));
    assert(!result.text.includes(fixtureAccount));
    assert(!result.text.includes('account_ref'));
  }
  assert.equal((await viewer.get('/api/transactions').query({ q: fixtureAccount })).body.total, 0);
  const detail = await viewer.get('/api/transactions/' + fixtureId);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.account_masked, 'XXXX-4321');
  assert.equal(detail.body.model_version, 'fixture-v1');
  assert.equal(detail.body.top_reasons[0].metadata.weight, 1);
  assert(!detail.text.includes(fixtureAccount));
  assert(!detail.text.includes('account_ref'));
  const alertId = detail.body.alert.alert_id;
  assert.equal((await viewer.patch('/api/alerts/' + alertId).send({ state: 'UNDER_REVIEW' })).status, 403);
  for (const agent of [admin, analyst]) {
    const result = await agent.get('/api/alerts');
    assert.equal(result.status, 200);
    assert.equal(result.body.total, 2);
    assert(result.body.items.every((item) => item.account_masked === 'XXXX-4321'));
    assert(!result.text.includes(fixtureAccount));
    assert(!result.text.includes('account_ref'));
  }
  assert.equal((await analyst.patch('/api/alerts/' + alertId).send({ state: 'UNDER_REVIEW' })).body.state, 'UNDER_REVIEW');
  const resolved = await admin.patch('/api/alerts/' + alertId).send({ state: 'RESOLVED', resolution: 'CONFIRMED_FRAUD' });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.state, 'RESOLVED');
  assert(!resolved.text.includes(fixtureAccount));
  assert(!resolved.text.includes('account_ref'));
  console.log('PASS: ADMIN and service intake, fixture scoring and persistence, alert investigation, masked REST and socket data, and foreign/anonymous socket denial');

  const { id } = (await query("SELECT id FROM users WHERE username = 'viewer'")).rows[0];
  assert.equal((await admin.patch('/api/users/' + id).send({ role: 'ANALYST' })).status, 200);
  assert.equal((await viewer.get('/api/auth/me')).body.role, 'ANALYST');
  assert.equal((await admin.patch('/api/users/' + id).send({ status: 'DISABLED' })).status, 200);
  assert.equal((await viewer.get('/api/auth/me')).status, 401);
  const closed = once(socket, 'close');
  await socketApi.broadcastAlert({ alert_id: 12 });
  assert.equal((await closed)[0], 4401);
  assert.equal((await admin.get('/api/audit-logs?include_hash=true')).status, 200);
  assert.equal((await admin.post('/api/auth/logout')).status, 204);
  assert.equal((await admin.get('/api/auth/me')).status, 401);
  console.log('PASS: scoped audit API, revocable REST and WebSocket permissions, masking and logout');

  await Promise.all(Array.from({ length: 12 }, (_, index) => audit({
    action: 'ALERT_RAISED', entity: 'fixture', entityId: String(index),
    details: { z: index, a: { tag: 'synthetic' } },
  })));
  const { rows: [counts] } = await query(
    "SELECT count(*) FILTER (WHERE entity = 'fixture') AS fixtures, count(*) FILTER (WHERE prev_hash = $1) AS genesis FROM audit_logs",
    [GENESIS_HASH]
  );
  assert.deepEqual(counts, { fixtures: '12', genesis: '1' });
  console.log(runScript('scripts/verify_audit_chain.js'));
  console.log('PASS: 12 concurrent PostgreSQL audit writes verified without a fork');

  const auditRows = 'SELECT * FROM audit_logs ORDER BY id';
  const before = (await query(auditRows)).rows;
  const auditFixture = await pool.connect();
  try {
    await auditFixture.query('BEGIN');
    await auditFixture.query(
      "UPDATE audit_logs SET details = details || '{\"task02_fixture\":true}' WHERE id = $1",
      [before[0].id]
    );
    const { rows } = await auditFixture.query(auditRows);
    assert.deepEqual(firstMismatch(rows), { id: before[0].id, field: 'entry_hash' });
  } finally {
    try {
      await auditFixture.query('ROLLBACK');
    } finally {
      auditFixture.release();
    }
  }
  assert.deepEqual((await query(auditRows)).rows, before);
  runScript('scripts/verify_audit_chain.js');
  console.log('PASS: verifier detects the changed PostgreSQL fixture row; rollback preserves the original audit chain');

}

main().catch((error) => {
  console.error('Disposable PostgreSQL verification failed:', error.stack?.split(/\r?\n/).filter((line) => /^\s+at /.test(line)).slice(0, 3).join(' '));
  process.exitCode = 1;
}).finally(async () => {
  closeAlertSocket?.();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  if (mlServer?.listening) await new Promise((resolve) => mlServer.close(resolve));
  await pool?.end();
});
