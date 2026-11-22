const assert = require('node:assert/strict');
const http = require('node:http');
const { randomBytes } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { createRequire } = require('node:module');
const path = require('node:path');

const backend = path.resolve(__dirname, '../backend');
const backendRequire = createRequire(path.join(backend, 'package.json'));
const database = new URL(process.env.DATABASE_URL || '');
assert.equal(database.hostname, '127.0.0.1');
assert.equal(database.pathname, '/fraudlens_phase2_verification');
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
const app = backendRequire('./src/app');
const { audit, GENESIS_HASH } = backendRequire('./src/audit/auditLogger');
const { query, pool } = backendRequire('./src/config/db');
const { broadcastAlert, initAlertSocket, closeAlertSocket } = backendRequire('./src/websocket/alertSocket');
const server = http.createServer(app);

function runScript(script, extraEnv = {}) {
  const run = spawnSync(process.execPath, [script], {
    cwd: backend, encoding: 'utf8', env: { ...process.env, ...extraEnv },
  });
  assert.equal(run.status, 0, run.stderr);
  return run.stdout.trim();
}

async function main() {
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

  const admin = request.agent(app);
  const viewer = request.agent(app);
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

  const deniedIngestion = await request(app).post('/api/transactions')
    .set('X-Service-Token', 'incorrect-fixture');
  assert.equal(deniedIngestion.status, 401);
  assert.equal(deniedIngestion.body.error.code, 'UNAUTHENTICATED');

  const fixtureId = 'corrections-demo-tx';
  const fixtureAccount = 'synthetic-account-4321';
  await query(
    `INSERT INTO transactions (transaction_id, account_ref, amount, tx_time, category, ingested_at)
     VALUES ($1, $2, 19.95, now(), 'retail', now())`,
    [fixtureId, fixtureAccount]
  );
  for (const term of ['XXXX-4321', fixtureId]) {
    const result = await viewer.get('/api/transactions').query({ q: term });
    assert.equal(result.status, 200);
    assert.equal(result.body.total, 1);
    assert.equal(result.body.items[0].account_masked, 'XXXX-4321');
    assert(!result.text.includes(fixtureAccount));
  }
  assert.equal((await viewer.get('/api/transactions').query({ q: fixtureAccount })).body.total, 0);
  console.log('PASS: invalid service token HTTP 401, masked search and ID search with no raw account match');

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  process.env.WS_ALLOWED_ORIGINS = origin;
  initAlertSocket(server);
  const wsUrl = 'ws://127.0.0.1:' + server.address().port + '/ws/alerts';
  assert.equal((await once(new WebSocket(wsUrl, { origin }), 'close'))[0], 4401);
  const cookie = signedInViewer.headers['set-cookie'][0].split(';', 1)[0];
  const foreign = new WebSocket(wsUrl, { origin: 'https://foreign.example.test', headers: { cookie } });
  const [, rejectedUpgrade] = await once(foreign, 'unexpected-response');
  rejectedUpgrade.resume();
  assert.equal(rejectedUpgrade.statusCode, 403);
  console.log('PASS: valid session at a foreign WebSocket origin rejected with HTTP 403');
  const socket = new WebSocket(wsUrl, { origin, headers: { cookie } });
  await once(socket, 'open');
  const message = once(socket, 'message');
  await broadcastAlert({ alert_id: 11, account_ref: 'fixture-account-1234' });
  const { alert } = JSON.parse((await message)[0]);
  assert.equal(alert.account_masked, 'XXXX-1234');
  assert.equal(alert.account_ref, undefined);

  const { id } = (await query("SELECT id FROM users WHERE username = 'viewer'")).rows[0];
  assert.equal((await admin.patch('/api/users/' + id).send({ role: 'ANALYST' })).status, 200);
  assert.equal((await viewer.get('/api/auth/me')).body.role, 'ANALYST');
  assert.equal((await admin.patch('/api/users/' + id).send({ status: 'DISABLED' })).status, 200);
  assert.equal((await viewer.get('/api/auth/me')).status, 401);
  const closed = once(socket, 'close');
  await broadcastAlert({ alert_id: 12 });
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
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  closeAlertSocket();
  if (server.listening) await new Promise((resolve) => server.close(resolve));
  await pool.end();
});
