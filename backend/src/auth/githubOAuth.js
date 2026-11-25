const { createHash, randomBytes } = require('node:crypto');
const { parseOrigin } = require('../middleware/browserRequest');

const GITHUB_NAMESPACE = 'https://github.com';
const AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_URL = 'https://api.github.com/user';
const verifierPattern = /^[A-Za-z0-9_-]{43}$/;

function enabledGitHub(env = process.env) {
  if (env.SOCIAL_OAUTH_ENABLED !== 'true') return null;
  const { GITHUB_OAUTH_CLIENT_ID: clientId, GITHUB_OAUTH_CLIENT_SECRET: clientSecret,
    GITHUB_OAUTH_REDIRECT_URI: redirectUri, OAUTH_PUBLIC_ORIGIN: origin } = env;
  if (!clientId && !clientSecret && !redirectUri) return null;
  if (typeof origin !== 'string' || parseOrigin(origin) !== origin || !origin.startsWith('https://') ||
      env.COOKIE_SECURE !== 'true' || !clientId?.trim() || !clientSecret?.trim() ||
      redirectUri !== origin + '/api/auth/github/callback') {
    throw new Error('Incomplete GitHub OAuth configuration or unexpected HTTPS callback URI.');
  }
  return { name: 'github', origin, redirectUri, clientId, clientSecret };
}

function githubError(message, code, providerError) {
  return Object.assign(new Error(message), { code, error: providerError });
}

async function responseJson(fetch, url, options) {
  const exchange = url === TOKEN_URL;
  const responseCode = exchange ? 'GITHUB_TOKEN_RESPONSE' : 'GITHUB_USER_RESPONSE';
  let response;
  try {
    response = await fetch(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(8000) });
  } catch {
    throw githubError('GitHub OAuth request failed.', exchange ? 'GITHUB_TOKEN_REQUEST' : 'GITHUB_USER_REQUEST');
  }
  const json = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() === 'application/json';
  const payload = json ? await response.json().catch(() => null) : null;
  if (response.status !== 200 || !json) {
    throw githubError('Unexpected GitHub OAuth response.', responseCode, exchange ? payload?.error : undefined);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.hasOwn(payload, 'error')) {
    throw githubError('Invalid GitHub OAuth response.', responseCode, exchange ? payload?.error : undefined);
  }
  return payload;
}

function createGitHubClient(provider, fetch = globalThis.fetch) {
  return {
    begin(state) {
      const verifier = randomBytes(32).toString('base64url');
      const url = new URL(AUTHORIZE_URL);
      url.search = new URLSearchParams({
        client_id: provider.clientId,
        redirect_uri: provider.redirectUri,
        scope: '',
        state,
        code_challenge_method: 'S256',
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      });
      return { location: url.href, nonce: null, verifier };
    },
    async verify(callback, attempt) {
      const code = callback.searchParams.get('code');
      if (callback.origin + callback.pathname !== provider.redirectUri ||
          callback.searchParams.get('state') !== attempt.state || !code || callback.searchParams.has('iss') ||
          !verifierPattern.test(attempt.code_verifier ?? '')) {
        throw githubError('Invalid GitHub OAuth callback or PKCE verifier.', 'GITHUB_CALLBACK_INVALID');
      }
      const token = await responseJson(fetch, TOKEN_URL, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: provider.clientId,
          client_secret: provider.clientSecret,
          code,
          redirect_uri: provider.redirectUri,
          code_verifier: attempt.code_verifier,
        }),
      });
      // A dedicated, expiring-token OAuth App must issue an unscoped bearer token.
      if (!Number.isSafeInteger(token.expires_in) || token.expires_in < 1 || token.expires_in > 28_800) {
        throw githubError('Invalid GitHub OAuth access token expiry.', 'GITHUB_TOKEN_EXPIRY');
      }
      if (token.scope !== '') {
        throw githubError('GitHub OAuth token has unexpected scopes.', 'GITHUB_TOKEN_SCOPE');
      }
      if (typeof token.access_token !== 'string' || !/^[A-Za-z0-9_]+$/.test(token.access_token) ||
          token.access_token.length > 512 || typeof token.token_type !== 'string' || token.token_type.toLowerCase() !== 'bearer') {
        throw githubError('Invalid GitHub OAuth access token response.', 'GITHUB_TOKEN_FORMAT');
      }
      const user = await responseJson(fetch, USER_URL, {
        method: 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: 'Bearer ' + token.access_token,
          'X-GitHub-Api-Version': '2026-03-10',
          'User-Agent': 'FraudLens',
        },
      });
      if (!Number.isSafeInteger(user.id) || user.id < 1) {
        throw githubError('Invalid GitHub account identifier.', 'GITHUB_USER_ID');
      }
      return { issuer: GITHUB_NAMESPACE, subject: String(user.id) };
    },
  };
}

module.exports = { enabledGitHub, createGitHubClient, GITHUB_NAMESPACE };
