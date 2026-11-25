const { createHash } = require('node:crypto');
const { createGitHubClient, enabledGitHub } = require('../auth/githubOAuth');

const origin = 'https://fraudlens.test';
const env = {
  SOCIAL_OAUTH_ENABLED: 'true', COOKIE_SECURE: 'true', OAUTH_PUBLIC_ORIGIN: origin,
  GITHUB_OAUTH_CLIENT_ID: 'fixture-id', GITHUB_OAUTH_CLIENT_SECRET: 'fixture-only-secret',
  GITHUB_OAUTH_REDIRECT_URI: origin + '/api/auth/github/callback',
};
const provider = enabledGitHub(env);
const token = { access_token: 'secure_fixture', scope: '', token_type: 'bearer', expires_in: 28_800 };

function setup() {
  const fetch = jest.fn();
  const json = (payload, status = 200) => ({ status, headers: new Headers({ 'Content-Type': 'application/json' }), json: async () => payload });
  const client = createGitHubClient(provider, fetch);
  const state = 'state-fixture';
  const start = client.begin(state);
  const callback = new URL(provider.redirectUri + '?code=code-fixture&state=' + state);
  const attempt = { state, code_verifier: start.verifier };
  return { fetch, json, client, start, callback, attempt };
}

test('configuration defaults off and requires the exact secure callback', () => {
  expect(enabledGitHub({ ...env, SOCIAL_OAUTH_ENABLED: 'false' })).toBeNull();
  expect(enabledGitHub({ SOCIAL_OAUTH_ENABLED: 'true' })).toBeNull();
  expect(() => enabledGitHub({ ...env, GITHUB_OAUTH_REDIRECT_URI: provider.redirectUri + '?next=x' })).toThrow();
  expect(() => enabledGitHub({ ...env, COOKIE_SECURE: 'false' })).toThrow();
  expect(() => enabledGitHub({ ...env, GITHUB_OAUTH_CLIENT_SECRET: '' })).toThrow();
  const insecure = 'http://localhost:5173';
  expect(() => enabledGitHub({ ...env, OAUTH_PUBLIC_ORIGIN: insecure,
    GITHUB_OAUTH_REDIRECT_URI: insecure + '/api/auth/github/callback' })).toThrow();
});

test('accepts the published GitHub authorization issuer and retains the stored identity namespace', async () => {
  const { fetch, json, client, callback, attempt } = setup();
  callback.searchParams.set('iss', 'https://github.com/login/oauth');
  fetch.mockResolvedValueOnce(json(token)).mockResolvedValueOnce(json({ id: 12345 }));
  await expect(client.verify(callback, attempt)).resolves.toEqual({
    issuer: 'https://github.com', subject: '12345',
  });
});

test.each([
  ['https://provider.invalid'],
  [''],
  ['https://github.com/login/oauth', 'https://github.com/login/oauth'],
])('rejects unexpected or duplicate GitHub authorization issuers %#', async (...issuers) => {
  const { fetch, client, callback, attempt } = setup();
  for (const issuer of issuers) callback.searchParams.append('iss', issuer);
  await expect(client.verify(callback, attempt)).rejects.toMatchObject({ code: 'GITHUB_CALLBACK_ISSUER' });
  expect(fetch).not.toHaveBeenCalled();
});

test('uses S256, fixed HTTPS endpoints and authenticates only the numeric ID', async () => {
  const { fetch, json, client, start, callback, attempt } = setup();
  const authorization = new URL(start.location);
  expect(authorization.origin + authorization.pathname).toBe('https://github.com/login/oauth/authorize');
  expect(authorization.searchParams.get('scope')).toBe('');
  expect(authorization.searchParams.get('state')).toBe(attempt.state);
  expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
  expect(authorization.searchParams.get('code_challenge'))
    .toBe(createHash('sha256').update(attempt.code_verifier).digest('base64url'));
  expect(authorization.searchParams.has('client_secret')).toBe(false);
  expect(start.nonce).toBeNull();
  fetch.mockResolvedValueOnce(json({ ...token, refresh_token: 'discarded-fixture' }))
    .mockResolvedValueOnce(json({ id: 12345, login: 'renamable', email: 'ignored', role: 'ADMIN' }));
  await expect(client.verify(callback, attempt)).resolves.toEqual({ issuer: 'https://github.com', subject: '12345' });
  expect(fetch).toHaveBeenNthCalledWith(1, 'https://github.com/login/oauth/access_token',
    expect.objectContaining({ method: 'POST', redirect: 'error', signal: expect.any(AbortSignal) }));
  const body = fetch.mock.calls[0][1].body;
  expect(Object.fromEntries(body)).toEqual({ client_id: provider.clientId, client_secret: provider.clientSecret,
    redirect_uri: provider.redirectUri, code: 'code-fixture', code_verifier: start.verifier });
  expect(fetch).toHaveBeenNthCalledWith(2, 'https://api.github.com/user', expect.objectContaining({
    method: 'GET', redirect: 'error', signal: expect.any(AbortSignal),
    headers: expect.objectContaining({ Authorization: 'Bearer secure_fixture' }),
  }));
});

test('invalid callback, wrong state or missing PKCE verifier stops before network access', async () => {
  const { fetch, client, callback, attempt } = setup();
  await expect(client.verify(callback, { ...attempt, state: 'different' })).rejects.toThrow();
  await expect(client.verify(callback, { ...attempt, code_verifier: null })).rejects.toThrow();
  await expect(client.verify(new URL('https://foreign.test' + callback.pathname + callback.search), attempt)).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});

test('GitHub rejects a mismatched PKCE verifier before the user request', async () => {
  const { fetch, json, client, callback, attempt } = setup();
  fetch.mockImplementation(async (_url, { body }) => {
    expect(body.get('code_verifier')).toBe('A'.repeat(43));
    return json({ error: 'incorrect_code_verifier' }, 400);
  });
  await expect(client.verify(callback, { ...attempt, code_verifier: 'A'.repeat(43) })).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
});

test.each([200, 400])('retains the token exchange error code for HTTP %i without the description', async (status) => {
  const { fetch, json, client, callback, attempt } = setup();
  fetch.mockResolvedValueOnce(json({
    error: 'incorrect_client_credentials',
    error_description: 'private provider description',
  }, status));
  await expect(client.verify(callback, attempt)).rejects.toMatchObject({
    code: 'GITHUB_TOKEN_RESPONSE', error: 'incorrect_client_credentials',
    message: expect.not.stringContaining('private provider description'),
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});

test.each([
  { access_token: null }, { access_token: 'line\nbreak' }, { token_type: 'other' },
  { scope: 'repo' }, { expires_in: undefined }, { expires_in: 90_000 }, { error: 'invalid_grant' },
])('rejects malformed, broad or non-expiring token responses %#', async (override) => {
  const { fetch, json, client, callback, attempt } = setup();
  fetch.mockResolvedValueOnce(json({ ...token, ...override }));
  await expect(client.verify(callback, attempt)).rejects.toThrow();
  expect(fetch).toHaveBeenCalledTimes(1);
});

test.each([undefined, '12345', 0, 0.5, Number.MAX_SAFE_INTEGER + 1])('rejects malformed GitHub ID %#', async (id) => {
  const { fetch, json, client, callback, attempt } = setup();
  fetch.mockResolvedValueOnce(json(token)).mockResolvedValueOnce(json({ id }));
  await expect(client.verify(callback, attempt)).rejects.toThrow('Invalid GitHub account identifier.');
});

test('rejects authenticated user API failures', async () => {
  const { fetch, json, client, callback, attempt } = setup();
  fetch.mockResolvedValueOnce(json(token)).mockResolvedValueOnce(json({ message: 'fixture denied' }, 403));
  await expect(client.verify(callback, attempt)).rejects.toThrow('Unexpected GitHub OAuth response.');
});
