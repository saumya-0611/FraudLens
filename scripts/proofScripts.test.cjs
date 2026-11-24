const assert = require('node:assert/strict');
const { execFile, spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { createServer } = require('node:http');
const path = require('node:path');
const { test } = require('node:test');
const { promisify } = require('node:util');

const runNode = promisify(execFile);

function runProbe(script, config = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^FRAUDLENS_PROOF_|^NODE_OPTIONS$/i.test(key)) delete env[key];
  }
  const guard = `
    function forbidden() {
      process.stderr.write('UNEXPECTED NETWORK ATTEMPT\\n');
      process.exit(91);
    }
    require('node:net').Socket.prototype.connect = forbidden;
    globalThis.fetch = forbidden;
    require(process.argv[1]);
  `;
  const result = spawnSync(process.execPath, ['-e', guard, path.join(__dirname, script)], {
    env: { ...env, ...config },
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  return result.stderr;
}

test('HTTP proof requires explicit configuration and refuses invalid targets before any connection', () => {
  assert.match(runProbe('test_app_live.js'), /FRAUDLENS_PROOF_ORIGIN/);
  for (const origin of [
    'https://example.invalid:5000',
    'http://localhost:5000',
    'http://127.0.0.1',
    'http://user:synthetic-secret@127.0.0.1:5000',
    'http://127.0.0.1:5000/health',
  ]) {
    const stderr = runProbe('test_app_live.js', { FRAUDLENS_PROOF_ORIGIN: origin });
    assert.match(stderr, /exact HTTP loopback origin/);
    assert.doesNotMatch(stderr, /synthetic-secret/);
  }
});

test('database proof refuses missing or invalid configuration even with a runtime database URL', () => {
  const database = 'fraudlens_proof_fixture';
  const synthetic = 'postgres://proof:synthetic-secret@127.0.0.1:6543/' + database;
  assert.match(runProbe('verify_neon_e2e.js', { DATABASE_URL: synthetic }), /FRAUDLENS_PROOF_DATABASE/);
  const config = { FRAUDLENS_PROOF_DATABASE: database };
  assert.match(runProbe('verify_neon_e2e.js', config), /FRAUDLENS_PROOF_DATABASE_URL/);
  for (const url of [
    synthetic.replace('127.0.0.1', 'example.invalid'),
    synthetic.replace(database, 'wrong_database'),
    synthetic + '?options=unsafe',
    synthetic.replace(':synthetic-secret', ''),
    synthetic.replace('synthetic-secret', '%00synthetic-secret'),
  ]) {
    const stderr = runProbe('verify_neon_e2e.js', { ...config, FRAUDLENS_PROOF_DATABASE_URL: url });
    assert.match(stderr, /FRAUDLENS_PROOF_DATABASE_URL/);
    assert.doesNotMatch(stderr, /synthetic-secret/);
  }
});

test('HTTP proof sends only anonymous GETs to the exact loopback origin', async (t) => {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ method: req.method, path: req.url, cookie: req.headers.cookie });
    res.writeHead(req.url === '/health' ? 200 : 401).end('{}');
  });
  server.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await once(server, 'listening');
  const { stdout, stderr } = await runNode(process.execPath, [path.join(__dirname, 'test_app_live.js')], {
    env: { ...process.env, FRAUDLENS_PROOF_ORIGIN: 'http://127.0.0.1:' + server.address().port },
    timeout: 8000,
  });
  assert.equal(stderr, '');
  assert.match(stdout, /Anonymous alert read denial passed with HTTP 401/);
  assert.deepEqual(requests, ['/health', '/api/auth/me', '/api/transactions', '/api/alerts'].map(
    (pathname) => ({ method: 'GET', path: pathname, cookie: undefined })
  ));
});
