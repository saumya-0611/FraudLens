const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');
const { signToken, verifyRequestCookie } = require('../utils/jwt');

jest.mock('../config/db', () => ({ query: jest.fn() }));
jest.mock('../audit/auditLogger', () => ({ audit: jest.fn() }));
jest.mock('../auth/oauthStore', () => ({
  ready: jest.fn(), saveAttempt: jest.fn(), consumeAttempt: jest.fn(), resolveIdentity: jest.fn(),
}));
jest.mock('../auth/oidc', () => ({
  enabledProviders: () => Object.fromEntries(['google', 'linkedin'].map((name) => [name, {
    name, origin: 'https://fraudlens.test', redirectUri: 'https://fraudlens.test/api/auth/' + name + '/callback',
  }])),
  providerClient: jest.fn(),
}));

jest.mock('../auth/githubOAuth', () => ({
  enabledGitHub: () => ({
    name: 'github', origin: 'https://fraudlens.test', redirectUri: 'https://fraudlens.test/api/auth/github/callback',
  }),
  createGitHubClient: (provider) => require('../auth/oidc').providerClient(provider),
}));

const { query } = require('../config/db');
const { audit } = require('../audit/auditLogger');
const store = require('../auth/oauthStore');
const { providerClient } = require('../auth/oidc');
const router = require('../routes/oauth.routes');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');

let testClient = 0;
const app = express()
  .use((req, _res, next) => {
    // Each test has its own client IP while repeated requests within that test share a limit.
    Object.defineProperty(req, 'ip', { value: '192.0.2.' + testClient });
    req.id = 'r-010203';
    next();
  })
  .use(cookieParser())
  .use('/api/auth', router);
app.get('/admin-fixture', authenticate, authorize('ADMIN'), (_req, res) => res.status(204).end());
const origins = { google: 'https://accounts.google.com', linkedin: 'https://www.linkedin.com/oauth', github: 'https://github.com' };
const viewer = { id: 51, username: 'social-local-viewer', role: 'VIEWER', status: 'ACTIVE' };
const admin = { id: 52, username: 'existing-admin', role: 'ADMIN', status: 'ACTIVE' };
const verify = jest.fn();
let attempts;
let server;
let adminCookie;

beforeAll(async () => {
  process.env.JWT_SECRET = 'oauth-routes-test-fixture-secret-at-least-32';
  process.env.COOKIE_SECURE = 'true';
  adminCookie = 'fl_token=' + signToken(admin);
  server = await new Promise((resolve) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
  });
});
afterAll(() => new Promise((resolve) => server.close(resolve)));
beforeEach(() => {
  jest.resetAllMocks();
  testClient += 1;
  attempts = new Map();
  store.ready.mockResolvedValue(true);
  store.saveAttempt.mockImplementation(async (attempt) => attempts.set(attempt.stateHash, attempt));
  store.consumeAttempt.mockImplementation(async (state, browser, provider) => {
    const attempt = attempts.get(state);
    if (!attempt || attempt.browserHash !== browser || attempt.provider !== provider || attempt.expired) return;
    attempts.delete(state);
    return {
      nonce: attempt.nonce, code_verifier: attempt.verifier,
      link_user_id: attempt.linkUserId, link_session_hash: attempt.linkSessionHash,
    };
  });
  providerClient.mockImplementation(async ({ name }) => ({
    begin: async (state) => ({
      location: origins[name] + '/authorize?state=' + state, nonce: 'fixture-nonce', verifier: null,
    }),
    verify: async (url, attempt) => {
      return { issuer: origins[name], subject: 'stable-subject', ...await verify(url, attempt) };
    },
  }));
  store.resolveIdentity.mockResolvedValue({ kind: 'registered', user: viewer });
  query.mockResolvedValue({ rows: [admin] });
});

const client = () => request(server);
const prefix = '/api/auth/';
const localCookie = () => adminCookie;

async function start(provider = 'google', link = false) {
  const res = link
    ? await client().post(prefix + provider + '/link').set('Origin', 'https://fraudlens.test').set('Cookie', localCookie())
    : await client().get(prefix + provider + '/start');
  expect(res.status).toBe(303);
  const url = new URL(res.headers.location);
  expect(url.origin).toBe(new URL(origins[provider]).origin);
  const cookie = res.headers['set-cookie'][0];
  expect(cookie).toContain('Path=' + prefix + provider + '/callback');
  expect(cookie).toContain('HttpOnly');
  expect(cookie).toContain('Secure');
  expect(cookie).toContain('SameSite=Lax');
  return { state: url.searchParams.get('state'), cookie: cookie.split(';')[0] };
}

function callback(provider, attempt, options = {}) {
  return client().get(prefix + provider + '/callback').query({
    state: attempt.state, code: 'fixture-code', ...options.query,
  }).set('Cookie', [attempt.cookie, options.session].filter(Boolean).join('; '));
}

test.each(['google', 'linkedin', 'github'])('%s registers and issues the normal VIEWER session', async (provider) => {
  const attempt = await start(provider);
  const res = await callback(provider, attempt, { query: { role: 'ADMIN', next: 'https://example.invalid' } });
  expect(res.status).toBe(303);
  expect(res.headers.location).toBe('/dashboard');
  expect(res.headers['cache-control']).toBe('no-store');
  expect(res.headers['referrer-policy']).toBe('no-referrer');
  const cookie = res.headers['set-cookie'].find((value) => value.startsWith('fl_token='));
  expect(verifyRequestCookie({ headers: { cookie } })).toEqual({
    id: viewer.id, username: viewer.username, role: 'VIEWER',
  });
  expect(store.resolveIdentity).toHaveBeenCalledWith({ issuer: origins[provider], subject: 'stable-subject' }, null);
  expect(audit.mock.calls.map(([event]) => event.action)).toEqual(['USER_CREATED', 'LOGIN_SUCCESS']);
  for (const [event] of audit.mock.calls) expect(event.details).not.toHaveProperty('code');
  query.mockResolvedValueOnce({ rows: [viewer] });
  expect((await client().get('/admin-fixture').set('Cookie', cookie.split(';')[0])).status).toBe(403);
});

test('a returning account retains its local role and does not register again', async () => {
  store.resolveIdentity.mockResolvedValue({ kind: 'login', user: admin });
  const res = await callback('google', await start());
  expect(res.headers.location).toBe('/dashboard');
  expect(audit.mock.calls.map(([event]) => event.action)).toEqual(['LOGIN_SUCCESS']);
});

test('Google callback passes the profile name into the session without changing the local identity', async () => {
  verify.mockResolvedValueOnce({ displayName: 'Fixture Person' });
  store.resolveIdentity.mockResolvedValueOnce({ kind: 'login', user: viewer });
  const res = await callback('google', await start());

  expect(res.headers.location).toBe('/dashboard');
  const cookie = res.headers['set-cookie'].find(value => value.startsWith('fl_token='));
  expect(verifyRequestCookie({ headers: { cookie } })).toEqual({
    id: viewer.id, username: viewer.username, role: viewer.role, display_name: 'Fixture Person',
  });
});

test('LinkedIn with a missing nonce cannot create an identity or a session', async () => {
  const warning = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    verify.mockRejectedValueOnce(Object.assign(new Error('Invalid response', {
      cause: new Error('JWT "nonce" (nonce) claim missing'),
    }), { code: 'OAUTH_INVALID_RESPONSE' }));
    const res = await callback('linkedin', await start('linkedin'));

    expect(res.headers.location).toBe('/?oauth_error=linkedin_unavailable');
    expect(store.resolveIdentity).not.toHaveBeenCalled();
    expect(res.headers['set-cookie'].some(value => value.startsWith('fl_token='))).toBe(false);
  } finally {
    warning.mockRestore();
  }
});

test('missing schema keeps all providers unavailable', async () => {
  store.ready.mockResolvedValue(false);
  expect((await client().get(prefix + 'providers')).body).toEqual({ google: false, linkedin: false, github: false });
  const res = await client().get(prefix + 'google/start');
  expect(res.headers.location).toBe('/?oauth_error=unavailable');
  expect(providerClient).not.toHaveBeenCalled();
});

test('concurrent copies of one callback can consume the attempt only once', async () => {
  const attempt = await start();
  const responses = await Promise.all([callback('google', attempt), callback('google', attempt)]);
  expect(responses.map((res) => res.headers.location).sort()).toEqual(['/?oauth_error=state', '/dashboard']);
  expect(verify).toHaveBeenCalledTimes(1);
  expect(store.resolveIdentity).toHaveBeenCalledTimes(1);
});

test('concurrent browser flows receive distinct state and correlation cookies', async () => {
  const attempts = await Promise.all([start(), start()]);
  expect(attempts[0].state).not.toBe(attempts[1].state);
  expect(attempts[0].cookie.split('=')[1]).not.toBe(attempts[1].cookie.split('=')[1]);
});

test('provider mismatch, mismatched proof, and expiration stop before token exchange', async () => {
  const attempt = await start();
  const wrong = await callback('linkedin', attempt);
  const other = await start();
  const wrongProof = await callback('google', { ...attempt, cookie: other.cookie });
  for (const stored of attempts.values()) stored.expired = true;
  const expired = await callback('google', attempt);
  expect([wrong, wrongProof, expired].map((res) => res.headers.location))
    .toEqual(Array(3).fill('/?oauth_error=state'));
  expect(verify).not.toHaveBeenCalled();
});

test('disabled accounts never receive the session cookie', async () => {
  store.resolveIdentity.mockResolvedValue({ kind: 'disabled' });
  const res = await callback('google', await start());
  expect(res.headers.location).toBe('/?oauth_error=disabled');
  expect(res.headers['set-cookie'].some((value) => value.startsWith('fl_token='))).toBe(false);
});

test('denied consent, provider errors and reused codes expose only fixed errors', async () => {
  const attempt = await start();
  const denied = await client().get(prefix + 'google/callback')
    .query({ state: attempt.state, error: 'access_denied', error_description: 'PRIVATE-FIXTURE' })
    .set('Cookie', attempt.cookie);
  expect(denied.headers.location).toBe('/?oauth_error=denied');
  expect(denied.text).not.toContain('PRIVATE-FIXTURE');
  verify.mockRejectedValueOnce(new Error('PRIVATE-FIXTURE reused code'));
  const invalid = await callback('google', await start());
  expect(invalid.headers.location).toBe('/?oauth_error=provider');
  expect(invalid.text).not.toContain('PRIVATE-FIXTURE');
  expect(store.resolveIdentity).not.toHaveBeenCalled();
});

test('records the callback stage and known provider code without logging provider descriptions', async () => {
  const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    verify.mockRejectedValueOnce(Object.assign(new Error('PRIVATE-FIXTURE'), { code: 'OAUTH_RESPONSE_BODY_ERROR', error: 'invalid_client' }));
    const failure = await callback('linkedin', await start('linkedin'));
    expect(failure.headers.location).toBe('/?oauth_error=provider');
    expect(failure.text).not.toContain('PRIVATE-FIXTURE');
    expect(warn).toHaveBeenCalledWith('[OAuth callback failed]', expect.objectContaining({
      provider: 'linkedin', stage: 'provider_verification', reason: 'invalid_client', requestId: 'r-010203',
    }));
    expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE-FIXTURE');
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'LOGIN_FAILURE',
      details: expect.objectContaining({ stage: 'provider_verification', reason: 'invalid_client' }),
    }));

    store.resolveIdentity.mockRejectedValueOnce(Object.assign(new Error('PRIVATE-DB-FIXTURE'), { code: '23505' }));
    const identityFailure = await callback('github', await start('github'));
    expect(identityFailure.headers.location).toBe('/?oauth_error=provider');
    expect(warn).toHaveBeenLastCalledWith('[OAuth callback failed]', expect.objectContaining({
      provider: 'github', stage: 'identity_lookup', reason: '23505',
    }));
    expect(JSON.stringify(warn.mock.calls)).not.toContain('PRIVATE-DB-FIXTURE');
  } finally {
    warn.mockRestore();
  }
});

test('linking requires an authenticated, same-origin POST and the same session at completion', async () => {
  expect((await client().post(prefix + 'google/link')).status).toBe(401);
  expect((await client().post(prefix + 'google/link').set('Cookie', localCookie())).status).toBe(403);
  const noSession = await callback('google', await start('google', true));
  expect(noSession.headers.location).toBe('/?oauth_error=state');
  expect(store.resolveIdentity).not.toHaveBeenCalled();

  store.resolveIdentity.mockResolvedValue({ kind: 'linked', user: admin });
  const linked = await callback('google', await start('google', true), { session: localCookie() });
  expect(linked.headers.location).toBe('/dashboard');
  expect(store.resolveIdentity).toHaveBeenCalledWith(expect.anything(), admin.id);
  expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'EXTERNAL_IDENTITY_LINKED' }));
  expect(linked.headers['set-cookie'].some((value) => value.startsWith('fl_token='))).toBe(false);
});

test('GitHub migration readiness does not gate Google or LinkedIn', async () => {
  store.ready.mockImplementation(async (provider) => provider !== 'github');
  expect((await client().get(prefix + 'providers')).body).toEqual({ google: true, linkedin: true, github: false });
  expect((await client().get(prefix + 'github/start')).headers.location).toBe('/?oauth_error=unavailable');
  expect(providerClient).not.toHaveBeenCalled();
});

test('GitHub denial consumes the browser attempt and returns a safe fixed error', async () => {
  const attempt = await start('github');
  const denial = await client().get(prefix + 'github/callback')
    .query({ state: attempt.state, error: 'access_denied', error_description: 'private-fixture' })
    .set('Cookie', attempt.cookie);
  expect(denial.headers.location).toBe('/?oauth_error=denied');
  expect(denial.text).not.toContain('private-fixture');
  expect((await callback('github', attempt)).headers.location).toBe('/?oauth_error=state');
  expect(verify).not.toHaveBeenCalled();
});
