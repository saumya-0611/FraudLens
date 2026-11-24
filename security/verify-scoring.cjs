const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const http = require('node:http');
const { createRequire } = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');

const backend = createRequire(path.resolve(__dirname, '../backend/package.json'));
const mode = process.env.PIPELINE_MODE;
const prefix = 'task05-' + mode;
const secret = () => randomBytes(24).toString('hex');
const close = async (server) => {
  if (!server?.listening) return;
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
};

async function waitFor(check, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  do {
    const result = await check();
    if (result) return result;
    await delay(100);
  } while (Date.now() < deadline);
  throw new Error('Timed out: ' + label);
}

async function verifyBrowser(origin, cookie, expected) {
  const profile = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'fraudlens-scoring-chrome-'));
  let chrome;
  let socket;
  try {
    chrome = spawn(process.env.FRAUDLENS_CHROME, [
      '--headless=new', '--remote-debugging-port=0', '--disable-background-networking',
      '--no-first-run', '--user-data-dir=' + profile, 'about:blank',
    ], { windowsHide: true, stdio: 'ignore' });
    const port = await waitFor(async () => {
      try {
        return (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
      } catch {
        return null;
      }
    }, 'Chrome DevTools');
    const pages = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    socket = new WebSocket(pages.find(({ type }) => type === 'page').webSocketDebuggerUrl);
    await once(socket, 'open');
    let id = 0;
    function command(method, params) {
      const sequence = ++id;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          socket.removeEventListener('message', receive);
          reject(new Error('Chrome command timed out: ' + method));
        }, 5000);
        function receive(event) {
          const response = JSON.parse(event.data);
          if (response.id !== sequence) return;
          socket.removeEventListener('message', receive);
          clearTimeout(timer);
          if (response.error) reject(new Error('Chrome command failed: ' + method));
          else resolve(response.result);
        }
        socket.addEventListener('message', receive);
        socket.send(JSON.stringify({ id: sequence, method, params }));
      });
    }
    await command('Network.setCookie', { url: origin, name: 'fl_token', value: cookie.slice('fl_token='.length), httpOnly: true });
    const url = origin + '/transactions?transaction=' + encodeURIComponent(expected.transaction_id);
    await command('Page.navigate', { url });
    for (const verify of ['navigate', 'reload']) {
      if (verify === 'reload') await command('Page.reload', {});
      await waitFor(async () => {
        const result = await command('Runtime.evaluate', {
          expression: 'document.querySelector("[role=dialog]")?.innerText || ""', returnByValue: true,
        });
        const text = result.result.value;
        return text.includes(expected.transaction_id) && text.includes(expected.account_masked) &&
          text.includes(expected.model_version) && text.includes((expected.fraud_probability * 100).toFixed(1) + '%');
      }, 'scored transaction detail');
    }
    console.log('PASS: Chrome displayed the persisted masked result, score and model version after navigation and reload.');
  } finally {
    socket?.close();
    if (chrome?.pid && chrome.exitCode === null && chrome.signalCode === null) {
      const stopped = once(chrome, 'exit');
      chrome.kill();
      await stopped;
    }
    if (path.dirname(profile) === await fs.realpath(os.tmpdir()) && path.basename(profile).startsWith('fraudlens-scoring-chrome-')) {
      await fs.rm(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
    }
  }
}

let stage = 'configuration';
async function verify() {
  const database = new URL(process.env.FRAUDLENS_SCORING_DATABASE_URL);
  const ml = new URL(process.env.FRAUDLENS_SCORING_ML_ORIGIN);
  assert(['inline', 'kafka'].includes(mode));
  assert(database.protocol === 'postgresql:' && database.hostname === '127.0.0.1' && database.port && database.username && database.password &&
    /^\/fraudlens_scoring_[a-f0-9]{16}$/.test(database.pathname) && !database.search && !database.hash);
  assert(ml.protocol === 'http:' && ml.hostname === '127.0.0.1' && ml.port && ml.origin === process.env.FRAUDLENS_SCORING_ML_ORIGIN);
  if (mode === 'kafka') assert.match(process.env.KAFKA_BROKERS || '', /^127\.0\.0\.1:\d+$/);
  assert(process.env.INTERNAL_ML_TOKEN);

  const tracked = new Map();
  const blocked = new Set();
  const conflictId = prefix + '-conflict';
  let releaseConflict;
  const conflictGate = new Promise((resolve) => { releaseConflict = resolve; });
  const gateway = http.createServer(async (req, res) => {
    try {
      assert.equal(req.headers['x-internal-token'], process.env.INTERNAL_ML_TOKEN);
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const payload = JSON.parse(Buffer.concat(chunks));
      for (const instance of payload.instances) {
        const calls = tracked.get(instance.transaction_id) || [];
        calls.push(instance);
        tracked.set(instance.transaction_id, calls);
      }
      const id = payload.instances[0].transaction_id;
      if (blocked.has(id)) {
        res.writeHead(503).end();
        return;
      }
      if (id === conflictId) {
        const first = tracked.get(id).length === 1;
        if (mode === 'inline' && first) await conflictGate;
        const highRiskFixture = mode === 'inline' ? first : !first;
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
          model_version: 'controlled-conflict',
          predictions: [{ transaction_id: id, fraud_probability: highRiskFixture ? 0.95 : 0.20,
            anomaly_score: 0, is_anomaly: false, top_reasons: [] }],
        }));
        return;
      }
      const prediction = await fetch(ml.origin + '/predict', {
        method: 'POST', body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json', 'X-Internal-Token': process.env.INTERNAL_ML_TOKEN },
        signal: AbortSignal.timeout(10000),
      });
      res.writeHead(prediction.status, { 'Content-Type': 'application/json' }).end(await prediction.text());
    } catch {
      res.writeHead(500).end();
    }
  });

  let pool, appServer, ws, closeAlertSocket, stopAlertConsumer, disconnectProducer, worker;
  let processedBatches = 0;
  let workerErrors = '';
  gateway.listen(0, '127.0.0.1');
  try {
    await once(gateway, 'listening');
    process.env.DATABASE_URL = database.href;
    process.env.DATABASE_URL_UNPOOLED = database.href;
    process.env.DATABASE_SSL = 'false';
    process.env.ML_SERVICE_URL = 'http://127.0.0.1:' + gateway.address().port;
    process.env.JWT_SECRET = secret();
    process.env.NODE_ENV = 'development';
    process.env.COOKIE_SECURE = 'false';
    process.env.SOCIAL_OAUTH_ENABLED = 'false';

    const db = backend('./src/config/db');
    pool = db.pool;
    const { query } = db;
    const { audit } = backend('./src/audit/auditLogger');
    const { firstMismatch } = backend('./scripts/verify_audit_chain');
    const bcrypt = backend('bcryptjs');
    const { computeFeatures, classifyRisk } = backend('./src/pipeline/inlineScorer');
    const alerts = backend('./src/kafka/alertConsumer');
    stopAlertConsumer = alerts.stopAlertConsumer;
    disconnectProducer = backend('./src/kafka/producer').disconnectProducer;
    const socketApi = backend('./src/websocket/alertSocket');
    closeAlertSocket = socketApi.closeAlertSocket;

    const current = await query('SELECT current_database() AS name');
    assert.equal(current.rows[0].name, database.pathname.slice(1));
    const fixtureUser = prefix + '-reviewer';
    const password = secret();
    await query("INSERT INTO users (username, password_hash, role) VALUES ($1,$2,'ADMIN')",
      [fixtureUser, await bcrypt.hash(password, 10)]);

    const express = backend('express');
    const root = express();
    const dist = path.resolve(__dirname, '../frontend/dist');
    root.use(express.static(dist, { index: false }));
    root.get(['/transactions', '/'], (_req, res) => res.sendFile(path.join(dist, 'index.html')));
    root.use(backend('./src/app'));
    appServer = root.listen(0, '127.0.0.1');
    await once(appServer, 'listening');
    const origin = 'http://127.0.0.1:' + appServer.address().port;
    process.env.WS_ALLOWED_ORIGINS = origin;
    socketApi.initAlertSocket(appServer);

    async function api(route, { method = 'GET', body, cookie } = {}) {
      return fetch(origin + route, {
        method, ...(body && { body: JSON.stringify(body) }),
        headers: { ...(body && { 'Content-Type': 'application/json' }), ...(cookie && { Cookie: cookie }) },
        signal: AbortSignal.timeout(6000),
      });
    }
    const loggedIn = await api('/api/auth/login', { method: 'POST', body: { username: fixtureUser, password } });
    assert.equal(loggedIn.status, 200);
    const cookie = loggedIn.headers.getSetCookie()[0].split(';')[0];
    await loggedIn.body.cancel();
    const messages = [];
    const WsClient = backend('ws');
    ws = new WsClient(origin.replace('http:', 'ws:') + '/ws/alerts', { origin, headers: { Cookie: cookie } });
    await once(ws, 'open');
    ws.on('message', (data) => messages.push(JSON.parse(data).alert));

    if (mode === 'kafka') {
      stage = 'Kafka broker and Python fallback startup';
      let joined = false;
      alerts.consumer.on(alerts.consumer.events.GROUP_JOIN, () => { joined = true; });
      await alerts.startAlertConsumer({ onAudit: audit });
      await waitFor(() => joined, 'Kafka alert group');
      worker = spawn(process.env.FRAUDLENS_PYTHON, ['-B', '-m', 'streaming.jobs.consumer_fallback'], {
        env: { ...process.env, PYTHONUNBUFFERED: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let workerReady = false;
      worker.stdout.on('data', (bytes) => {
        const line = bytes.toString();
        if (line.includes('Connected to Kafka')) workerReady = true;
        processedBatches += (line.match(/Processed batch/g) || []).length;
      });
      worker.stderr.on('data', (bytes) => { workerErrors = (workerErrors + bytes.toString()).slice(-4000); });
      await waitFor(() => workerReady, 'Python fallback connected to Kafka');
    }

    stage = 'select high-risk input from actual inference';
    const makeTx = (id, amount, category = 'shopping_net', hour = '02') => ({
      transaction_id: id, account_ref: 'synthetic-' + id + '-7890', amount,
      tx_time: '2026-11-25T' + hour + ':15:00Z', category, lat: 40, lon: -74, merch_lat: 46, merch_lon: -80, customer_age: 42,
    });
    const candidates = [500, 900, 1500, 3000, 8000].flatMap((amount) =>
      ['shopping_net', 'misc_net', 'grocery_pos'].map((category) => makeTx('probe-' + amount + '-' + category, amount, category)));
    const probe = await fetch(ml.origin + '/predict', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Internal-Token': process.env.INTERNAL_ML_TOKEN },
      body: JSON.stringify({ instances: candidates.map((tx) => ({ transaction_id: tx.transaction_id, features: computeFeatures(tx, []) })) }),
      signal: AbortSignal.timeout(10000),
    });
    assert.equal(probe.status, 200);
    const preflight = await probe.json();
    const index = preflight.predictions.findIndex((value) => classifyRisk(value.fraud_probability, value.is_anomaly) === 'HIGH_RISK');
    assert(index >= 0, 'No genuine high-risk candidate was found.');
    const candidate = { ...candidates[index], transaction_id: prefix + '-high', account_ref: 'synthetic-' + prefix + '-high-7890' };

    async function post(tx) {
      const response = await api('/api/transactions', { method: 'POST', body: tx, cookie });
      assert.equal(response.status, 202);
      assert.deepEqual(await response.json(), { transaction_id: tx.transaction_id, status: 'ACCEPTED' });
    }
    async function read(id) {
      const response = await api('/api/transactions/' + id, { cookie });
      const text = await response.text();
      if (response.status === 404) return null;
      assert.equal(response.status, 200);
      assert(!text.includes('synthetic-'));
      return JSON.parse(text);
    }
    const score = (id) => waitFor(async () => {
      const result = await read(id);
      return result?.model_version && result;
    }, 'persisted prediction');
    async function counts(id) {
      const { rows: [row] } = await query(
        "SELECT (SELECT count(*)::int FROM transactions WHERE transaction_id=$1) AS transactions, " +
        "(SELECT count(*)::int FROM fraud_results WHERE transaction_id=$1) AS scores, " +
        "(SELECT count(*)::int FROM alerts WHERE transaction_id=$1) AS alerts, " +
        "(SELECT count(*)::int FROM audit_logs WHERE action='ALERT_RAISED' AND details->>'transaction_id'=$1) AS audits",
        [id]
      );
      return row;
    }

    stage = 'API, real ML, persisted score and socket delivery';
    await Promise.all([post(candidate), post(candidate)]);
    const result = await score(candidate.transaction_id);
    assert.equal(result.model_version, preflight.model_version);
    assert.equal(result.risk_category, 'HIGH_RISK');
    assert.equal(result.account_masked, 'XXXX-7890');
    assert.equal(Object.keys(result.features).length, 13);
    await waitFor(() => messages.some((message) => message.transaction_id === candidate.transaction_id), 'alert socket event');
    assert.equal(messages.filter((message) => message.transaction_id === candidate.transaction_id).length, 1);
    assert.deepEqual(await counts(candidate.transaction_id), { transactions: 1, scores: 1, alerts: 1, audits: 1 });
    assert(tracked.get(candidate.transaction_id)?.length >= 1);
    console.log('PASS:', JSON.stringify({ mode, id: candidate.transaction_id, model: result.model_version,
      probability: result.fraud_probability, risk: result.risk_category, ...await counts(candidate.transaction_id) }));

    if (mode === 'inline') {
      stage = 'outage and durable recovery using the canonical accepted request';
      const recovery = makeTx(prefix + '-recovery', 28, 'grocery_pos', '14');
      blocked.add(recovery.transaction_id);
      await post(recovery);
      await waitFor(() => tracked.has(recovery.transaction_id), 'controlled ML outage');
      const pending = await read(recovery.transaction_id);
      assert.equal(pending.risk_category, 'PENDING');
      assert.equal(pending.fraud_probability, null);
      assert.equal(pending.model_version, null);
      assert.deepEqual(pending.top_reasons, []);
      assert.deepEqual(await counts(recovery.transaction_id), { transactions: 1, scores: 0, alerts: 0, audits: 0 });
      console.log('PASS:', JSON.stringify({ id: recovery.transaction_id, risk: pending.risk_category,
        probability: pending.fraud_probability, ...await counts(recovery.transaction_id) }));

      blocked.delete(recovery.transaction_id);
      await post({ ...recovery, amount: 1_000_000 });
      const recovered = await score(recovery.transaction_id);
      assert.equal(recovered.amount, recovery.amount);
      assert.equal(tracked.get(recovery.transaction_id).at(-1).features.amount, recovery.amount);
      console.log('PASS:', JSON.stringify({ id: recovery.transaction_id, model: recovered.model_version,
        probability: recovered.fraud_probability, risk: recovered.risk_category, ...await counts(recovery.transaction_id) }));

      stage = 'conflicting concurrent retry';
      const conflict = makeTx(conflictId, 50);
      await post(conflict);
      await waitFor(() => tracked.get(conflictId)?.length === 1, 'delayed high-risk fixture');
      await post({ ...conflict, amount: 5000 });
      assert.equal((await score(conflictId)).risk_category, 'LEGITIMATE');
      releaseConflict();
      await delay(350);
      assert.deepEqual(await counts(conflictId), { transactions: 1, scores: 1, alerts: 0, audits: 0 });
      assert(!messages.some((message) => message.transaction_id === conflictId));
      await post(conflict);
      await delay(200);
      assert.equal(tracked.get(conflictId).length, 2);
      console.log('PASS: controlled conflicting retry committed one LEGITIMATE score with zero alerts, audits or broadcasts.');
      if (process.env.FRAUDLENS_CHROME) {
        stage = 'Chrome production bundle readback';
        await verifyBrowser(origin, cookie, result);
      }
    } else {
      stage = 'Kafka replay through the Python fallback';
      const before = tracked.get(candidate.transaction_id).length;
      const batches = processedBatches;
      await post(candidate);
      await waitFor(() => tracked.get(candidate.transaction_id).length > before && processedBatches > batches, 'fallback inferred and committed Kafka replay');
      await delay(350);
      assert.deepEqual(await counts(candidate.transaction_id), { transactions: 1, scores: 1, alerts: 1, audits: 1 });
      assert.equal(messages.filter((message) => message.transaction_id === candidate.transaction_id).length, 1);
      console.log('PASS: real Kafka and Python fallback replay preserved one score, alert, audit row and notification.');
      const conflict = makeTx(conflictId, 50);
      await post(conflict);
      assert.equal((await score(conflictId)).risk_category, 'LEGITIMATE');
      const priorBatches = processedBatches;
      await post(conflict);
      await waitFor(() => tracked.get(conflictId)?.length === 2 && processedBatches > priorBatches, 'fallback conflicting replay');
      await delay(350);
      assert.deepEqual(await counts(conflictId), { transactions: 1, scores: 1, alerts: 0, audits: 0 });
      assert(!messages.some((message) => message.transaction_id === conflictId));
      console.log('PASS: a controlled Kafka replay predicted HIGH_RISK but could not replace its stored LEGITIMATE score or publish an alert.');
    }

    const chain = await query('SELECT * FROM audit_logs ORDER BY id');
    assert.equal(firstMismatch(chain.rows), null);
    console.log('PASS: PostgreSQL audit chain verified across ' + chain.rows.length + ' entries.');
  } catch (error) {
    if (worker) {
      const failureTypes = [...workerErrors.matchAll(/^(\w+(?:Error|Exception)):/gm)].map((match) => match[1]);
      console.error('Kafka fallback diagnostic:', JSON.stringify({ exit: worker.exitCode, processedBatches,
        observedRequests: [...tracked.values()].map((requests) => requests.length), failureTypes }));
    }
    throw error;
  } finally {
    releaseConflict();
    if (worker?.pid && worker.exitCode === null && worker.signalCode === null) {
      const stopped = once(worker, 'exit');
      worker.kill();
      await stopped;
    }
    ws?.terminate();
    closeAlertSocket?.();
    await stopAlertConsumer?.();
    await disconnectProducer?.();
    await close(appServer);
    await close(gateway);
    await pool?.end();
  }
}

verify().catch((error) => {
  console.error('Disposable scoring verification failed at ' + stage + ' (' + error.name + '). ' +
    (error.message.startsWith('Timed out:') ? error.message + ' ' : '') +
    error.stack?.split(/\r?\n/).find((line) => /^\s+at /.test(line)));
  process.exitCode = 1;
});
