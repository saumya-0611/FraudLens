const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { createHash, generateKeyPairSync, randomBytes, X509Certificate } = require('node:crypto');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const https = require('node:https');
const { createRequire } = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');

const backend = createRequire(path.resolve(__dirname, '../backend/package.json'));
const names = ['google', 'linkedin', 'github'];
const issuers = { google: 'https://accounts.google.com', linkedin: 'https://www.linkedin.com/oauth', github: 'https://github.com' };
const available = { google: true, linkedin: true, github: true };
const unavailable = { google: false, linkedin: false, github: false };
const secret = () => randomBytes(32).toString('hex');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

async function checkBrowser(origin, cert) {
  const chrome = process.env.FRAUDLENS_CHROME;
  if (!chrome) return;
  const spki = new X509Certificate(cert).publicKey.export({ format: 'der', type: 'spki' });
  const fingerprint = createHash('sha256').update(spki).digest('base64');
  const profile = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'fraudlens-oauth-chrome-'));
  try {
    const { stdout } = await promisify(execFile)(chrome, [
      '--headless=new', '--disable-background-networking', '--no-first-run', '--no-default-browser-check',
      '--ignore-certificate-errors-spki-list=' + fingerprint, '--user-data-dir=' + profile,
      '--virtual-time-budget=5000', '--dump-dom', origin + '/?oauth_error=denied',
    ], { windowsHide: true, timeout: 20000 });
    assert.match(stdout, /<button type="button"><span class="social-icon google-icon"[^>]*>G<\/span>Google<\/button>/);
    assert.match(stdout, /<button type="button"><span class="social-icon linkedin-icon"[^>]*>in<\/span>LinkedIn<\/button>/);
    assert.match(stdout, /<button type="button">GitHub<\/button>/);
    assert.match(stdout, /role="status"[^>]*>[^<]*cancel/i);
    console.log('PASS: Chrome over HTTPS rendered all three enabled provider buttons and the denied-consent message');
  } finally {
    await fs.rm(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  }
}

async function verify() {
  const target = new URL(process.env.FRAUDLENS_OAUTH_FIXTURE_DATABASE_URL);
  assert(target.protocol === 'postgresql:' && target.hostname === '127.0.0.1' && target.port &&
    target.username && target.password && !target.search && !target.hash &&
    /^\/fraudlens_oauth_fixture_[a-f0-9]{16}$/.test(target.pathname), 'Expected the explicit disposable OAuth database.');

  const [cert, key] = await Promise.all([
    fs.readFile(process.env.FRAUDLENS_OAUTH_FIXTURE_CERT),
    fs.readFile(process.env.FRAUDLENS_OAUTH_FIXTURE_KEY),
  ]);
  let app;
  let pool;
  const server = https.createServer({ cert, key }, (req, res) => app(req, res));
  server.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const origin = 'https://localhost:' + server.address().port;
    Object.assign(process.env, {
      DATABASE_URL: target.href, DATABASE_URL_UNPOOLED: target.href, DATABASE_SSL: 'false',
      NODE_ENV: 'development', PIPELINE_MODE: 'inline',
      JWT_SECRET: secret(), JWT_EXPIRES_IN: '2h', VITE_USE_MOCKS: 'false',
      SOCIAL_OAUTH_ENABLED: 'true', OAUTH_PUBLIC_ORIGIN: origin, COOKIE_SECURE: 'true',
      WS_ALLOWED_ORIGINS: origin,
    });
    for (const name of names) {
      const prefix = name === 'github' ? 'GITHUB_OAUTH' : name.toUpperCase();
      process.env[prefix + '_CLIENT_ID'] = 'local-signed-fixture-' + name;
      process.env[prefix + '_CLIENT_SECRET'] = secret();
      process.env[prefix + '_REDIRECT_URI'] = origin + '/api/auth/' + name + '/callback';
    }

    const exchanges = new Map();
    const exchanged = [];
    const jwt = backend('jsonwebtoken');
    const signature = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwks = { keys: [{ ...signature.publicKey.export({ format: 'jwk' }), kid: 'fixture', alg: 'RS256' }] };
    const oidc = backend('./src/auth/oidc');
    const github = backend('./src/auth/githubOAuth');
    const config = { ...oidc.enabledProviders(), github: github.enabledGitHub() };
    const createGitHubClient = github.createGitHubClient;
    const issuedGitHubTokens = new Map();
    github.createGitHubClient = (provider) => createGitHubClient(provider, async (url, options) => {
      if (url === 'https://api.github.com/user') {
        const token = options.headers.Authorization?.slice('Bearer '.length);
        const attempt = issuedGitHubTokens.get(token);
        assert(attempt);
        issuedGitHubTokens.delete(token);
        return Response.json({ id: attempt.claims?.invalidId ? 'invalid' : Number(attempt.subject),
          login: 'irrelevant-fixture-login', email: 'same-fixture@example.test', role: 'ADMIN' });
      }
      assert.equal(url, 'https://github.com/login/oauth/access_token');
      const code = options.body.get('code');
      const attempt = exchanges.get(code);
      assert(attempt?.name === 'github');
      assert.equal(options.body.get('client_secret'), provider.clientSecret);
      assert.equal(options.body.get('redirect_uri'), provider.redirectUri);
      assert.equal(createHash('sha256').update(options.body.get('code_verifier')).digest('base64url'), attempt.challenge);
      exchanges.delete(code);
      exchanged.push(code);
      const token = 'synthetic_private_' + secret();
      issuedGitHubTokens.set(token, attempt);
      return Response.json({ access_token: token, token_type: 'bearer', scope: '', expires_in: 28800 });
    });
    const clients = new Map();
    oidc.providerClient = (provider) => {
      if (!clients.has(provider.name)) {
        clients.set(provider.name, oidc.createProviderClient(provider, async (url, { body } = {}) => {
          const endpoint = String(url);
          if (endpoint.endsWith('/certs') || endpoint.endsWith('/jwks')) return Response.json(jwks);
          assert(endpoint.endsWith('/token') || endpoint.endsWith('/accessToken'));
          const params = new URLSearchParams(body);
          assert.equal(params.get('client_secret'), provider.clientSecret);
          assert.equal(params.get('redirect_uri'), provider.redirectUri);
          const code = params.get('code');
          const attempt = exchanges.get(code);
          if (!attempt || attempt.name !== provider.name) return Response.json({ error: 'invalid_grant' }, { status: 400 });
          exchanges.delete(code);
          exchanged.push(code);
          if (provider.name === 'google') {
            assert.equal(createHash('sha256').update(params.get('code_verifier')).digest('base64url'), attempt.challenge);
          } else {
            assert.equal(params.has('code_verifier'), false);
          }
          const token = jwt.sign({
            iss: issuers[provider.name], aud: provider.clientId, sub: attempt.subject,
            nonce: attempt.nonce, email: 'same-fixture@example.test', email_verified: true, role: 'ADMIN',
            ...attempt.claims,
          }, signature.privateKey, { algorithm: 'RS256', keyid: 'fixture', expiresIn: '10m' });
          return Response.json({ id_token: token, access_token: 'synthetic-private-access-token', token_type: 'Bearer' });
        }));
      }
      return clients.get(provider.name);
    };

    const db = backend('./src/config/db');
    pool = db.pool;
    const { query } = db;
    const { ready } = backend('./src/auth/oauthStore');
    const bcrypt = backend('bcryptjs');
    const express = backend('express');
    const dist = path.resolve(__dirname, '../frontend/dist');
    app = express();
    app.use(express.static(dist, { index: false }));
    app.get(['/', '/dashboard'], (_req, res) => res.sendFile(path.join(dist, 'index.html')));
    app.use(backend('./src/app'));

    function request(route, { method = 'GET', cookie, body, headers = {} } = {}) {
      return new Promise((resolve, reject) => {
        const req = https.request(new URL(route, origin), {
          ca: cert, servername: "localhost", family: 4, method, timeout: 6000,
          headers: { ...(cookie && { Cookie: cookie }), ...(body && { 'Content-Type': 'application/json' }), ...headers },
        }, (res) => {
          const chunks = [];
          res.on('data', (chunk) => chunks.push(chunk));
          res.on('error', reject);
          res.on('end', () => {
            const text = Buffer.concat(chunks).toString();
            const json = res.headers['content-type']?.startsWith('application/json') ? JSON.parse(text) : null;
            resolve({ status: res.statusCode, headers: res.headers, text, json });
          });
        });
        req.on('timeout', () => req.destroy(new Error('Local HTTPS request timed out.')));
        req.on('error', reject);
        req.end(body && JSON.stringify(body));
      });
    }
    function session(result) {
      const cookie = result.headers['set-cookie']?.find((value) => value.startsWith('fl_token='));
      assert(typeof cookie === 'string', 'Session cookie missing.');
      for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) assert(cookie.includes(flag));
      return cookie.split(';')[0];
    }
    async function begin(name, { linkCookie, subject = '724896', claims } = {}) {
      const start = await request('/api/auth/' + name + (linkCookie ? '/link' : '/start'), {
        method: linkCookie ? 'POST' : 'GET', cookie: linkCookie,
        headers: { ...(linkCookie && { Origin: origin }), Host: 'untrusted-fixture.invalid' },
      });
      assert.equal(start.status, 303);
      const provider = new URL(start.headers.location);
      const state = provider.searchParams.get('state');
      const challenge = provider.searchParams.get('code_challenge');
      assert.equal(provider.searchParams.get('redirect_uri'), config[name].redirectUri);
      assert.equal(Boolean(provider.searchParams.get('nonce')), name !== 'github');
      assert.equal(provider.searchParams.get('scope'), name === 'github' ? '' : 'openid profile email');
      assert.equal(provider.searchParams.get('code_challenge_method'), name === 'linkedin' ? null : 'S256');
      const [cookie] = start.headers['set-cookie'];
      assert(cookie.startsWith('fl_oauth_' + state + '='));
      for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/api/auth/' + name + '/callback']) assert(cookie.includes(flag));
      const code = 'synthetic-code-' + secret();
      exchanges.set(code, { name, subject, claims, challenge, nonce: provider.searchParams.get('nonce') });
      const callback = new URL(config[name].redirectUri);
      callback.searchParams.set('state', state);
      callback.searchParams.set('code', code);
      if (name === 'google') callback.searchParams.set('iss', issuers.google);
      const proof = cookie.split(';')[0];
      return {
        state, code, callback, proof,
        finish: () => request(callback.href, { cookie: linkCookie ? linkCookie + '; ' + proof : proof }),
      };
    }

    const baseline = (await query("SELECT current_database() AS database, count(*)::int AS count FROM users")).rows[0];
    assert.equal(baseline.database, target.pathname.slice(1));
    assert.equal(baseline.count, 0, 'Use a fresh disposable database.');
    assert.equal(await ready(), false);
    assert.deepEqual((await request('/api/auth/providers')).json, unavailable);
    const structural = () => query(
      "SELECT is_nullable FROM information_schema.columns WHERE table_schema='public' AND table_name='users' AND column_name='password_hash'"
    ).then(({ rows }) => rows[0].is_nullable);
    assert.equal(await structural(), 'NO');
    const password = secret();
    const { rows: [existing] } = await query(
      "INSERT INTO users (username, password_hash, role) VALUES ('fixture-admin',$1,'ADMIN') RETURNING *",
      [await bcrypt.hash(password, 10)]
    );
    const migration = await fs.readFile(path.resolve(__dirname, '../database/proposals/social-oauth.sql'), 'utf8');
    const migrationConnection = await pool.connect();
    try {
      await migrationConnection.query(migration);
    } catch (error) {
      await migrationConnection.query('ROLLBACK');
      throw error;
    } finally {
      migrationConnection.release();
    }
    await backend('./scripts/bootstrapSchema').ensureSchema();
    assert.equal(await structural(), 'YES');
    assert.equal(await ready(), true);
    assert.deepEqual((await query("SELECT * FROM users WHERE id = $1", [existing.id])).rows[0], existing);
    assert.deepEqual((await request('/api/auth/providers')).json, { ...available, github: false });
    const preserved = { google: await begin('google'), linkedin: await begin('linkedin') };
    const storedAttempts = () => query('SELECT * FROM oauth_attempts ORDER BY provider').then(({ rows }) => rows);
    const attemptsBefore = await storedAttempts();
    await query('INSERT INTO oauth_identities(issuer,subject,user_id) VALUES ($1,$2,$3)',
      [issuers.google, 'historic-fixture', existing.id]);
    const storedIdentity = () => query('SELECT * FROM oauth_identities WHERE user_id=$1', [existing.id])
      .then(({ rows }) => rows);
    const identityBefore = await storedIdentity();
    const migrateGitHub = await fs.readFile(path.resolve(__dirname, '../database/proposals/github-oauth.sql'), 'utf8');
    await query(migrateGitHub);
    assert.deepEqual(await storedAttempts(), attemptsBefore);
    assert.deepEqual(await storedIdentity(), identityBefore);
    assert.deepEqual((await request('/api/auth/providers')).json, available);
    for (const [name, nonce, verifier] of [['google', null, null], ['github', 'nonce-fixture', null], ['github', null, null]]) {
      await assert.rejects(query(
        'INSERT INTO oauth_attempts(state_hash,browser_hash,provider,nonce,code_verifier) VALUES ($1,$2,$3,$4,$5)',
        [secret(), secret(), name, nonce, verifier]
      ), { code: '23514' });
    }
    console.log('PASS: GitHub additive migration exposed GitHub only after installation and preserved both prior OIDC attempts');
    console.log('PASS: migration changed readiness from off to ready and preserved the original password row');

    if (process.env.FRAUDLENS_CHROME) await checkBrowser(origin, cert);

    const passwordResult = await request('/api/auth/login', { method: 'POST', body: { username: 'fixture-admin', password } });
    assert.equal(passwordResult.status, 200);
    const adminCookie = session(passwordResult);
    assert.equal((await request('/api/auth/me', { cookie: adminCookie })).json.role, 'ADMIN');

    const identities = [];
    for (const name of names) {
      const [first, second] = await Promise.all([preserved[name] ?? begin(name), begin(name)]);
      assert(first.state !== second.state);
      const attemptRow = (await query(
        'SELECT state_hash, browser_hash, nonce, code_verifier, extract(epoch FROM expires_at - now()) AS ttl FROM oauth_attempts WHERE state_hash=$1',
        [sha256(first.state)]
      )).rows[0];
      assert.equal(attemptRow.browser_hash, sha256(first.proof.split('=')[1]));
      assert(attemptRow.ttl > 540 && attemptRow.ttl <= 600);
      assert.equal(Boolean(attemptRow.code_verifier), name !== 'linkedin');

      const noProof = await request(first.callback.href);
      assert.equal(noProof.headers.location, '/?oauth_error=state');
      const results = await Promise.all([first.finish(), second.finish()]);
      assert(results.every((res) => res.status === 303 && res.headers.location === '/dashboard'));
      for (const result of results) {
        assert.equal(result.headers['cache-control'], 'no-store');
        assert.equal(result.headers['referrer-policy'], 'no-referrer');
      }
      const [cookie, duplicateCookie] = results.map(session);
      const me = await request('/api/auth/me', { cookie });
      assert.equal(me.status, 200);
      assert.equal(me.json.role, 'VIEWER');
      assert.deepEqual((await request('/api/auth/me', { cookie: duplicateCookie })).json, me.json);
      assert.equal((await request('/api/users', { cookie })).status, 403);
      const { rows: [identity] } = await query(
        'SELECT u.id, u.username, u.role, u.status, u.password_hash FROM oauth_identities i JOIN users u ON u.id=i.user_id WHERE i.issuer=$1 AND i.subject=$2',
        [issuers[name], '724896']
      );
      assert.equal(identity.username, me.json.username);
      assert.equal(identity.status, 'ACTIVE');
      assert.equal(identity.password_hash, null);
      identities.push(identity.id);
      await assert.rejects(query(
        'INSERT INTO oauth_identities(issuer,subject,user_id) VALUES ($1,$2,$3)',
        [issuers[name], '724896', existing.id]
      ), { code: '23505' });

      await assert.rejects(query(
        'INSERT INTO oauth_identities(issuer,subject,user_id) VALUES ($1,$2,$3)',
        [issuers[name], 'second-subject-fixture', identity.id]
      ), { code: '23505' });

      const logout = await request('/api/auth/logout', { method: 'POST', cookie, headers: { Origin: origin } });
      assert.equal(logout.status, 204);
      assert(logout.headers['set-cookie'].some((value) => value.startsWith('fl_token=;')));
      assert.equal((await request('/api/auth/me')).status, 401);
      assert.equal((await first.finish()).headers.location, '/?oauth_error=state');
      const returnResult = await (await begin(name)).finish();
      assert.deepEqual((await request('/api/auth/me', { cookie: session(returnResult) })).json, me.json);

      const expired = await begin(name);
      await query("UPDATE oauth_attempts SET expires_at=now()-interval '1 second' WHERE state_hash=$1", [sha256(expired.state)]);
      assert.equal((await expired.finish()).headers.location, '/?oauth_error=state');
      assert(!exchanged.includes(expired.code));
      const rejected = await (await begin(name, {
        claims: name === 'github' ? { invalidId: true } : { nonce: 'invalid-fixture-nonce' },
        subject: '352181',
      })).finish();
      assert.equal(rejected.headers.location, '/?oauth_error=provider');
      assert(!rejected.headers['set-cookie'].some((value) => value.startsWith('fl_token=')));
      assert.equal((await query("SELECT count(*) FROM oauth_identities WHERE subject = '352181'")).rows[0].count, '0');

      await query("UPDATE users SET status='DISABLED' WHERE id=$1", [identity.id]);
      assert.equal((await request('/api/auth/me', { cookie })).status, 401);
      const disabled = await (await begin(name)).finish();
      assert.equal(disabled.headers.location, '/?oauth_error=disabled');
      assert(!disabled.headers['set-cookie'].some((value) => value.startsWith('fl_token=')));
      console.log('PASS: ' + name + ' protocol fixture over HTTPS, including concurrent registration, returning login, VIEWER, expiry, logout and disable');
    }
    assert.equal(new Set(identities).size, 3);
    assert.equal((await query('SELECT count(*) FROM users')).rows[0].count, '4');

    const conflict = await begin('github', { linkCookie: adminCookie });
    assert.equal((await conflict.finish()).headers.location, '/?oauth_error=conflict');
    const link = await begin('github', { linkCookie: adminCookie, subject: '961753' });
    const linked = await link.finish();
    assert.equal(linked.headers.location, '/dashboard');
    assert(!linked.headers['set-cookie'].some((value) => value.startsWith('fl_token=')));
    const mapping = await query('SELECT user_id FROM oauth_identities WHERE issuer=$1 AND subject=$2', [issuers.github, '961753']);
    assert.equal(mapping.rows[0].user_id, existing.id);
    assert.equal((await request('/api/auth/me', { cookie: adminCookie })).json.role, 'ADMIN');
    const audits = (await query("SELECT action, details FROM audit_logs WHERE details->>'authentication' IN ('oidc', 'oauth')")).rows;
    assert.equal(audits.filter(({ action }) => action === 'USER_CREATED').length, 3);
    assert.equal(audits.filter(({ action }) => action === 'EXTERNAL_IDENTITY_LINKED').length, 1);
    for (const { details } of audits) {
      assert(Object.keys(details).every((key) => ['authentication', 'provider', 'provisioning', 'reason'].includes(key)));
    }
    console.log('PASS: password login, explicit same-origin linking, issuer separation and redacted OAuth audit records');
    console.log('Fixture callback origin: ' + origin);
  } finally {
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    await pool?.end();
  }
}

verify().catch((error) => {
  console.error('OAuth fixture verification failed:', error.stack?.split(/\r?\n/).filter((line) => /^\s+at /.test(line)).slice(0, 4).join(' '));
  process.exitCode = 1;
});
