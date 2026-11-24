const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, createHash } = require('node:crypto');
const jwt = require('jsonwebtoken');
const { enabledProviders, createProviderClient } = require('../../auth/oidc');

const signing = generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
const origin = 'https://fraudlens.test';
const issuers = { google: 'https://accounts.google.com', linkedin: 'https://www.linkedin.com/oauth' };
const jwks = { keys: [{ ...signing.publicKey.export({ format: 'jwk' }), kid: 'fixture', alg: 'RS256', use: 'sig' }] };

function config(name) {
  const prefix = name.toUpperCase();
  return enabledProviders({
    SOCIAL_OAUTH_ENABLED: 'true', OAUTH_PUBLIC_ORIGIN: origin, COOKIE_SECURE: 'true',
    [prefix + '_CLIENT_ID']: name + '-fixture-id',
    [prefix + '_CLIENT_SECRET']: 'controlled-fixture-secret',
    [prefix + '_REDIRECT_URI']: origin + '/api/auth/' + name + '/callback',
  })[name];
}

async function fixture(name, changed = {}, key = signing.privateKey, acceptedCode = 'fixture-code') {
  const provider = config(name);
  let attempt;
  let codeUsed = false;
  const requests = [];
  const fetch = async (url, { body } = {}) => {
    const target = String(url);
    if (target.endsWith('/certs') || target.endsWith('/jwks')) return Response.json(jwks);
    assert(target.endsWith('/token') || target.endsWith('/accessToken'));
    const params = new URLSearchParams(body);
    requests.push(params);
    assert.equal(params.get('client_secret'), provider.clientSecret);
    assert.equal(params.get('redirect_uri'), provider.redirectUri);
    if (params.get('code') !== acceptedCode || codeUsed) {
      return Response.json({ error: 'invalid_grant' }, { status: 400 });
    }
    codeUsed = true;
    const idToken = jwt.sign({
      iss: issuers[name], aud: provider.clientId, sub: 'same-provider-fixture',
      exp: Math.floor(Date.now() / 1000) + 600, nonce: attempt.nonce,
      ...changed,
    }, key, { algorithm: 'RS256', keyid: 'fixture' });
    return Response.json({ id_token: idToken, access_token: 'private-fixture', token_type: 'Bearer' });
  };
  const client = await createProviderClient(provider, fetch);
  const state = 'attempt-fixture-state';
  const start = await client.begin(state);
  attempt = { state, nonce: start.nonce, code_verifier: start.verifier };
  const callback = new URL(provider.redirectUri);
  callback.searchParams.set('state', state);
  callback.searchParams.set('code', 'fixture-code');
  return { client, attempt, callback, start, requests, provider };
}

for (const name of Object.keys(issuers)) {
  test(name + ' validates a signed provider identity and its declared PKCE support', async () => {
    const { client, attempt, callback, start, requests } = await fixture(name, { role: 'ADMIN' });
    const auth = new URL(start.location);
    assert.equal(auth.searchParams.get('nonce'), attempt.nonce);
    assert.equal(auth.searchParams.get('state'), attempt.state);
    assert.equal(auth.searchParams.get('response_type'), 'code');
    assert.equal(auth.searchParams.has('client_secret'), false);
    if (name === 'google') {
      assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
      assert.equal(auth.searchParams.get('code_challenge'),
        createHash('sha256').update(attempt.code_verifier).digest('base64url'));
    } else {
      assert.equal(auth.searchParams.has('code_challenge'), false);
    }
    assert.deepEqual(await client.verify(callback, attempt), {
      issuer: issuers[name], subject: 'same-provider-fixture',
    });
    assert.equal(requests[0].get('code_verifier'), attempt.code_verifier);
    await assert.rejects(() => client.verify(callback, attempt));
  });
}

for (const [description, claims] of [
  ['wrong issuer', { iss: 'https://other-fixture.invalid' }],
  ['wrong audience', { aud: 'other-fixture' }],
  ['wrong nonce', { nonce: 'other-fixture' }],
  ['expired ID token', { exp: 100 }],
  ['malformed email verification claim', { email_verified: 'true' }],
]) {
  test('rejects ' + description, async () => {
    const { client, attempt, callback } = await fixture('google', claims);
    await assert.rejects(() => client.verify(callback, attempt));
  });
}

test('rejects an ID token signed by a key outside the configured JWKS', async () => {
  const { client, attempt, callback } = await fixture('linkedin', {}, other.privateKey);
  await assert.rejects(() => client.verify(callback, attempt));
});

test('rejects the wrong state before token exchange', async () => {
  const { client, attempt, callback, requests } = await fixture('google');
  await assert.rejects(() => client.verify(callback, { ...attempt, state: 'different-state' }));
  assert.equal(requests.length, 0);
});

test('rejects a callback code returned as invalid by the provider', async () => {
  const { client, attempt, callback } = await fixture('linkedin', {}, signing.privateKey, 'different-code');
  await assert.rejects(() => client.verify(callback, attempt));
});

test('configuration defaults off and enforces the exact callback and HTTPS policy', () => {
  assert.deepEqual(enabledProviders({}), {});
  assert.throws(() => enabledProviders({
    SOCIAL_OAUTH_ENABLED: 'true', OAUTH_PUBLIC_ORIGIN: 'http://localhost:5173', NODE_ENV: 'production',
  }));
  assert.throws(() => enabledProviders({
    SOCIAL_OAUTH_ENABLED: 'true', OAUTH_PUBLIC_ORIGIN: origin, COOKIE_SECURE: 'true',
    GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret',
    GOOGLE_REDIRECT_URI: 'https://another.test/api/auth/google/callback',
  }));
});
