const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const { createRequire } = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { setTimeout: pause } = require('node:timers/promises');

const db = new URL(process.env.DATABASE_URL || '');
assert.equal(db.protocol, 'postgresql:');
assert.equal(db.hostname, '127.0.0.1');
assert.equal(db.pathname, '/fraudlens_phase2_browser');
assert(process.env.FRAUDLENS_CHROME, 'Set FRAUDLENS_CHROME to the local Chrome executable.');

const backend = path.resolve(__dirname, '../backend');
const browserBuild = path.resolve(__dirname, '../frontend/dist');
const backendRequire = createRequire(path.join(backend, 'package.json'));
process.env.JWT_SECRET = randomBytes(32).toString('hex');
process.env.COOKIE_SECURE = 'false';
process.env.NODE_ENV = 'development';
process.env.ML_SERVICE_URL = 'http://127.0.0.1:1';
for (const role of ['ADMIN', 'ANALYST', 'VIEWER']) {
  process.env['SEED_' + role + '_PASSWORD'] = randomBytes(20).toString('hex');
}

const express = backendRequire('express');
const { query, pool } = backendRequire('./src/config/db');
const { initAlertSocket, closeAlertSocket, broadcastAlert } = backendRequire('./src/websocket/alertSocket');
const root = express();
root.use(express.static(browserBuild, { index: false }));
root.get(['/', '/dashboard', '/admin/users'], (_req, res) => res.sendFile(path.join(browserBuild, 'index.html')));
root.use(backendRequire('./src/app'));

async function eventually(check) {
  for (let i = 0; i < 100; i++) {
    const result = await check();
    if (result) return result;
    await pause(100);
  }
  throw new Error('Timed out waiting for browser state.');
}

async function verify() {
  const { rows: [initial] } = await query('SELECT count(*) FROM users');
  assert.equal(initial.count, '0', 'Use a fresh disposable browser database.');
  const seeded = spawnSync(process.execPath, ['scripts/seed.js'], { cwd: backend, encoding: 'utf8' });
  assert.equal(seeded.status, 0, seeded.stderr);
  const tempRoot = await fs.realpath(os.tmpdir());
  const profile = await fs.mkdtemp(path.join(tempRoot, 'fraudlens-check-chrome-'));
  const server = root.listen(0, '127.0.0.1');
  initAlertSocket(server);
  let socket;
  let browser;
  try {
    await once(server, 'listening');
    const origin = 'http://127.0.0.1:' + server.address().port;
    browser = spawn(process.env.FRAUDLENS_CHROME, [
      '--headless=new', '--remote-debugging-port=0', '--disable-background-networking',
      '--no-first-run', '--no-default-browser-check', '--window-size=1100,720',
      '--user-data-dir=' + profile, origin,
    ], { windowsHide: true, stdio: 'ignore' });
    browser.on('error', () => {});
    const devtoolsPort = await eventually(async () => {
      try {
        return (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0];
      } catch {
        return null;
      }
    });
    const page = await eventually(async () => {
      const response = await fetch('http://127.0.0.1:' + devtoolsPort + '/json/list');
      return (await response.json()).find(({ type, url }) => type === 'page' && url.startsWith(origin));
    });
    socket = new WebSocket(page.webSocketDebuggerUrl);
    await once(socket, 'open');
    let sequence = 0;
    async function command(method, params = {}) {
      const id = ++sequence;
      const result = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          socket.removeEventListener('message', receive);
          reject(new Error('Browser command timed out: ' + method));
        }, 5000);
        function receive({ data }) {
          const message = JSON.parse(data);
          if (message.id !== id) return;
          clearTimeout(timer);
          socket.removeEventListener('message', receive);
          if (message.error) reject(new Error(message.error.message));
          else resolve(message.result);
        }
        socket.addEventListener('message', receive);
      });
      socket.send(JSON.stringify({ id, method, params }));
      return result;
    }
    async function evaluate(expression) {
      const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      assert(!result.exceptionDetails, 'Browser evaluation failed.');
      return result.result.value;
    }
    async function navigateTo(route) {
      await command('Page.navigate', { url: origin + route });
      await eventually(() => evaluate(
        'location.pathname === ' + JSON.stringify(route) + ' && document.readyState === "complete"'
      ).catch(() => false));
    }
    await eventually(() => evaluate('Boolean(document.querySelector("#username"))'));
    assert.equal(await evaluate('fetch("/api/auth/me").then(r => r.status)'), 401);
    await evaluate('document.querySelector("#username").focus()');
    await command('Input.insertText', { text: 'viewer' });
    await evaluate('document.querySelector("#password").focus()');
    await command('Input.insertText', { text: process.env.SEED_VIEWER_PASSWORD });
    await evaluate('document.querySelector("form button[type=submit]").click()');
    await eventually(() => evaluate('location.pathname === "/dashboard"'));
    assert.equal(await evaluate('fetch("/api/auth/me").then(r => r.json()).then(r => r.role)'), 'VIEWER');
    assert.equal(await evaluate('fetch("/api/users").then(r => r.status)'), 403);
    const { cookies } = await command('Network.getCookies', { urls: [origin] });
    const session = cookies.find(({ name }) => name === 'fl_token');
    assert.equal(session?.httpOnly, true);
    assert.equal(session?.sameSite, 'Lax');
    await eventually(() => evaluate('document.querySelector(".socket-status")?.textContent.includes("Connected")'));
    await broadcastAlert({ alert_id: 19, account_ref: 'fixture-account-1234' });
    await eventually(() => evaluate('document.body.textContent.includes("XXXX-1234")'));
    await navigateTo('/admin/users');
    await eventually(() => evaluate('document.querySelector("h1")?.textContent === "Not allowed"'));
    if (process.env.FRAUDLENS_CAPTURE_EVIDENCE === '1') {
      const { data } = await command('Page.captureScreenshot', { format: 'png' });
      await fs.writeFile(path.join(__dirname, '../docs/test-reports/security-browser.png'), Buffer.from(data, 'base64'));
    }
    await navigateTo('/dashboard');
    await eventually(() => evaluate('Boolean([...document.querySelectorAll("button")].find(b => b.textContent.includes("Sign out")))'));
    await evaluate('[...document.querySelectorAll("button")].find(b => b.textContent.includes("Sign out")).click()');
    await eventually(() => evaluate('location.pathname === "/" && Boolean(document.querySelector("#username"))'));
    assert.equal(await evaluate('fetch("/api/auth/me").then(r => r.status)'), 401);
    console.log('PASS: Chrome sign-in, masked live alert, cookie flags, VIEWER denial in UI and API, and sign-out');
  } finally {
    socket?.close();
    if (browser && browser.exitCode === null && browser.pid) {
      const stopped = once(browser, 'exit');
      browser.kill();
      await stopped;
    }
    closeAlertSocket();
    await new Promise((resolve) => server.close(resolve));
    try {
      const resolved = await fs.realpath(profile);
      if (path.dirname(resolved) === tempRoot && path.basename(resolved).startsWith('fraudlens-check-chrome-')) {
        await fs.rm(resolved, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      }
    } catch (error) {
      console.warn('Temporary browser profile cleanup deferred:', error.code);
    }
  }
}

verify().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(() => pool.end());
