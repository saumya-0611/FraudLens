const router = require('express').Router();
const { createHash, randomBytes } = require('node:crypto');
const rateLimit = require('express-rate-limit');
const authenticate = require('../middleware/authenticate');
const { getSessionUser } = authenticate;
const { audit } = require('../audit/auditLogger');
const { issueSession } = require('../auth/session');
const { enabledProviders, providerClient } = require('../auth/oidc');
const store = require('../auth/oauthStore');

const providers = enabledProviders();
const statePattern = /^[A-Za-z0-9_-]{43}$/;
const random = () => randomBytes(32).toString('base64url');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const names = ['google', 'linkedin'];
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
      details: { provider: provider.name, authentication: 'oidc', ...details },
    });
  } catch {
    console.error('OAuth audit write failed.');
  }
}

router.get('/providers', async (_req, res) => {
  protectResponse(res);
  const configured = Object.keys(providers);
  const ready = configured.length > 0 && await store.ready().catch(() => false);
  res.json(Object.fromEntries(names.map((name) => [name, ready && Object.hasOwn(providers, name)])));
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
    if (!await store.ready()) return result(res, 'unavailable');
    const sessionToken = linking ? req.cookies?.fl_token : null;
    if (linking && typeof sessionToken !== 'string') return result(res, 'state');
    const state = random();
    const browserProof = random();
    const client = await providerClient(provider);
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
  try {
    attempt = await store.consumeAttempt(hash(state), hash(proof), provider.name);
    if (!attempt) return result(res, 'state');
    const linking = attempt.link_user_id !== null;
    if (linking) {
      const token = req.cookies?.fl_token;
      const user = await getSessionUser(req);
      if (typeof token !== 'string' || user?.id !== attempt.link_user_id ||
          hash(token) !== attempt.link_session_hash) return result(res, 'state');
    }
    if (error === 'access_denied' && code === undefined) return result(res, 'denied');
    if (error !== undefined || typeof code !== 'string' || !code || code.length > 4096 ||
        (iss !== undefined && typeof iss !== 'string')) return result(res, 'provider');

    const callback = new URL(provider.redirectUri);
    callback.searchParams.set('state', state);
    callback.searchParams.set('code', code);
    if (iss !== undefined) callback.searchParams.set('iss', iss);
    const client = await providerClient(provider);
    const identity = await client.verify(callback, { ...attempt, state });
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
    await record(req, provider, 'LOGIN_SUCCESS', user);
    issueSession(res, user);
    return res.redirect(303, '/dashboard');
  } catch {
    if (attempt) await record(req, provider, 'LOGIN_FAILURE', null, { reason: 'oidc_failure' });
    return result(res, 'provider');
  }
});

module.exports = router;
