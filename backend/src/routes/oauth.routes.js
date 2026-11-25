const router = require('express').Router();
const { createHash, randomBytes } = require('node:crypto');
const rateLimit = require('express-rate-limit');
const authenticate = require('../middleware/authenticate');
const { getSessionUser } = authenticate;
const { audit } = require('../audit/auditLogger');
const { issueSession } = require('../auth/session');
const { enabledProviders, providerClient } = require('../auth/oidc');
const { enabledGitHub, createGitHubClient } = require('../auth/githubOAuth');
const store = require('../auth/oauthStore');

const providers = enabledProviders();
const github = enabledGitHub();
if (github) providers.github = github;

const getClient = (provider) => provider.name === 'github' ? createGitHubClient(provider) : providerClient(provider);
const statePattern = /^[A-Za-z0-9_-]{43}$/;
const random = () => randomBytes(32).toString('base64url');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const providerErrors = new Set([
  'invalid_client', 'invalid_grant', 'invalid_request', 'invalid_scope', 'unauthorized_client',
  'incorrect_client_credentials', 'redirect_uri_mismatch', 'bad_verification_code',
  'incorrect_code_verifier', 'unverified_user_email', 'server_error', 'temporarily_unavailable',
]);
const verificationErrors = new Set([
  'OAUTH_TIMEOUT', 'OAUTH_ABORT', 'OAUTH_INVALID_RESPONSE', 'OAUTH_RESPONSE_IS_NOT_JSON',
  'OAUTH_RESPONSE_IS_NOT_CONFORM', 'OAUTH_JWT_CLAIM_COMPARISON_FAILED',
  'OAUTH_JWT_TIMESTAMP_CHECK_FAILED', 'OAUTH_KEY_SELECTION_FAILED',
  'GITHUB_CALLBACK_INVALID', 'GITHUB_CALLBACK_ISSUER', 'GITHUB_TOKEN_REQUEST', 'GITHUB_TOKEN_RESPONSE',
  'GITHUB_TOKEN_EXPIRY', 'GITHUB_TOKEN_SCOPE', 'GITHUB_TOKEN_FORMAT',
  'GITHUB_USER_REQUEST', 'GITHUB_USER_RESPONSE', 'GITHUB_USER_ID',
]);

function failureReason(stage, error) {
  if (stage === 'provider_verification') {
    if (providerErrors.has(error?.error)) return error.error;
    if (error?.code === 'OAUTH_JWT_CLAIM_COMPARISON_FAILED' && error.cause?.cause?.claim === 'nonce') {
      return 'OIDC_NONCE_MISMATCH';
    }
    if (error?.code === 'OAUTH_INVALID_RESPONSE' && /^JWT "nonce".*claim missing$/.test(error.cause?.message ?? '')) {
      return 'OIDC_NONCE_MISSING';
    }
    if (verificationErrors.has(error?.code)) return error.code;
  }
  if ((stage === 'attempt_lookup' || stage === 'identity_lookup') &&
      typeof error?.code === 'string' && /^[0-9][0-9A-Z]{4}$/.test(error.code)) return error.code;
  return 'unexpected_error';
}

function logCallbackFailure(req, provider, stage, reason) {
  // The provider response can contain credentials and identity data. Log fixed codes only.
  console.warn('[OAuth callback failed]', { provider: provider.name, stage, reason, requestId: req.id });
}

const startLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (_req, res) => {
    protectResponse(res);
    return result(res, 'limited');
  },
});

function protectResponse(res) {
  res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
}

function result(res, status) {
  return res.redirect(303, '/?oauth_error=' + status);
}

function cookieOptions(provider) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: new URL(provider.origin).protocol === 'https:',
    path: new URL(provider.redirectUri).pathname,
  };
}

async function record(req, provider, action, user, details = {}) {
  try {
    await audit({
      req, action, entity: 'USER',
      userId: user?.id, username: user?.username,
      entityId: user ? String(user.id) : null,
      details: { provider: provider.name, authentication: provider.name === 'github' ? 'oauth' : 'oidc', ...details },
    });
  } catch {
    console.error('OAuth audit write failed.');
  }
}

router.get('/providers', async (_req, res) => {
  protectResponse(res);
  const oidcReady = (Object.hasOwn(providers, 'google') || Object.hasOwn(providers, 'linkedin')) &&
    await store.ready().catch(() => false);
  const githubReady = Object.hasOwn(providers, 'github') && await store.ready('github').catch(() => false);
  res.json({
    google: oidcReady && Object.hasOwn(providers, 'google'),
    linkedin: oidcReady && Object.hasOwn(providers, 'linkedin'),
    github: githubReady,
  });
});

async function start(req, res, linking) {
  protectResponse(res);
  const provider = providers[req.params.provider];
  if (!Object.hasOwn(providers, req.params.provider)) return result(res, 'unavailable');
  if (linking && req.get('Origin') !== provider.origin) {
    return res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Account linking requires the FraudLens origin.', request_id: req.id },
    });
  }
  try {
    if (!await store.ready(provider.name)) return result(res, 'unavailable');
    const sessionToken = linking ? req.cookies?.fl_token : null;
    if (linking && typeof sessionToken !== 'string') return result(res, 'state');
    const state = random();
    const browserProof = random();
    const client = await getClient(provider);
    const { location, nonce, verifier } = await client.begin(state);
    await store.saveAttempt({
      stateHash: hash(state), browserHash: hash(browserProof),
      provider: provider.name, nonce, verifier,
      linkUserId: linking ? req.user.id : null,
      linkSessionHash: linking ? hash(sessionToken) : null,
    });
    res.cookie('fl_oauth_' + state, browserProof, { ...cookieOptions(provider), maxAge: 600_000 });
    return res.redirect(303, location);
  } catch {
    return result(res, 'unavailable');
  }
}

router.get('/:provider/start', startLimiter, (req, res) => start(req, res, false));
router.post('/:provider/link', startLimiter, authenticate, (req, res) => start(req, res, true));

router.get('/:provider/callback', async (req, res) => {
  protectResponse(res);
  if (!Object.hasOwn(providers, req.params.provider)) return result(res, 'unavailable');
  const provider = providers[req.params.provider];
  const { state, code, error, iss } = req.query;
  if (typeof state !== 'string' || !statePattern.test(state)) return result(res, 'state');
  const cookie = 'fl_oauth_' + state;
  const proof = req.cookies?.[cookie];
  res.clearCookie(cookie, cookieOptions(provider));
  if (typeof proof !== 'string' || !statePattern.test(proof)) return result(res, 'state');

  let attempt;
  let stage = 'attempt_lookup';
  try {
    attempt = await store.consumeAttempt(hash(state), hash(proof), provider.name);
    if (!attempt) return result(res, 'state');
    const linking = attempt.link_user_id !== null;
    if (linking) {
      stage = 'link_session';
      const token = req.cookies?.fl_token;
      const user = await getSessionUser(req);
      if (typeof token !== 'string' || user?.id !== attempt.link_user_id ||
          hash(token) !== attempt.link_session_hash) return result(res, 'state');
    }
    if (error === 'access_denied' && code === undefined) return result(res, 'denied');
    if (error !== undefined || typeof code !== 'string' || !code || code.length > 4096 ||
        (iss !== undefined && typeof iss !== 'string')) {
      const reason = providerErrors.has(error) ? error : 'invalid_callback';
      logCallbackFailure(req, provider, 'authorization_response', reason);
      await record(req, provider, 'LOGIN_FAILURE', null, { stage: 'authorization_response', reason });
      return result(res, 'provider');
    }

    stage = 'provider_verification';
    const callback = new URL(provider.redirectUri);
    callback.searchParams.set('state', state);
    callback.searchParams.set('code', code);
    if (iss !== undefined) callback.searchParams.set('iss', iss);
    const client = await getClient(provider);
    const identity = await client.verify(callback, { ...attempt, state });
    stage = 'identity_lookup';
    const { kind, user } = await store.resolveIdentity(identity, attempt.link_user_id);
    if (kind === 'disabled' || kind === 'conflict') {
      await record(req, provider, 'LOGIN_FAILURE', null, { reason: kind });
      return result(res, kind);
    }
    if (linking) {
      if (kind === 'linked') await record(req, provider, 'EXTERNAL_IDENTITY_LINKED', user);
      return res.redirect(303, '/dashboard');
    }
    if (kind === 'registered') await record(req, provider, 'USER_CREATED', user, { provisioning: 'social' });
    stage = 'session_issue';
    issueSession(res, provider.name === 'google' ? { ...user, display_name: identity.displayName } : user);
    await record(req, provider, 'LOGIN_SUCCESS', user);
    return res.redirect(303, '/dashboard');
  } catch (failure) {
    const reason = failureReason(stage, failure);
    logCallbackFailure(req, provider, stage, reason);
    if (attempt) await record(req, provider, 'LOGIN_FAILURE', null, { stage, reason });
    if (provider.name === 'linkedin' && reason === 'OIDC_NONCE_MISSING') return result(res, 'linkedin_unavailable');
    return result(res, 'provider');
  }
});

module.exports = router;
