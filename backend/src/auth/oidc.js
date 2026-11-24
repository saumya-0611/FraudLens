const { parseOrigin } = require('../middleware/browserRequest');

const providers = {
  google: {
    issuer: 'https://accounts.google.com',
    authorization_endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    token_endpoint: 'https://oauth2.googleapis.com/token',
    jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs',
    code_challenge_methods_supported: ['S256'],
  },
  linkedin: {
    issuer: 'https://www.linkedin.com/oauth',
    authorization_endpoint: 'https://www.linkedin.com/oauth/v2/authorization',
    token_endpoint: 'https://www.linkedin.com/oauth/v2/accessToken',
    jwks_uri: 'https://www.linkedin.com/oauth/openid/jwks',
  },
};
const localOrigins = new Set(['localhost', '127.0.0.1', '[::1]']);
const cache = new WeakMap();

function enabledProviders(env = process.env) {
  if (env.SOCIAL_OAUTH_ENABLED !== 'true') return {};
  if (parseOrigin(env.OAUTH_PUBLIC_ORIGIN) !== env.OAUTH_PUBLIC_ORIGIN) {
    throw new Error('Invalid OAuth public origin.');
  }
  const origin = new URL(env.OAUTH_PUBLIC_ORIGIN);
  const localHttp = origin.protocol === 'http:' && localOrigins.has(origin.hostname) &&
    env.NODE_ENV !== 'production';
  if (origin.origin !== env.OAUTH_PUBLIC_ORIGIN ||
      (!localHttp && (origin.protocol !== 'https:' || env.COOKIE_SECURE !== 'true'))) {
    throw new Error('Invalid OAuth origin or cookie configuration.');
  }

  return Object.fromEntries(Object.keys(providers).flatMap((name) => {
    const prefix = name.toUpperCase();
    const clientId = env[prefix + '_CLIENT_ID'];
    const clientSecret = env[prefix + '_CLIENT_SECRET'];
    const redirectUri = env[prefix + '_REDIRECT_URI'];
    if (!clientId && !clientSecret && !redirectUri) return [];
    const expected = new URL('/api/auth/' + name + '/callback', origin);
    if (!clientId?.trim() || !clientSecret?.trim() || redirectUri !== expected.href ||
        (name === 'linkedin' && expected.protocol !== 'https:')) {
      throw new Error('Incomplete provider configuration or unexpected OAuth callback URI.');
    }
    return [[name, { name, clientId, clientSecret, redirectUri, origin: origin.origin }]];
  }));
}

async function createProviderClient(provider, customFetch) {
  const oidc = await import('openid-client');
  const metadata = providers[provider.name];
  const config = new oidc.Configuration(metadata, provider.clientId, {
    client_secret: provider.clientSecret,
    id_token_signed_response_alg: 'RS256',
  }, oidc.ClientSecretPost(provider.clientSecret));
  config.timeout = 8;
  oidc.enableNonRepudiationChecks(config);
  if (customFetch) config[oidc.customFetch] = customFetch;

  return {
    async begin(state) {
      const nonce = oidc.randomNonce();
      const verifier = config.serverMetadata().supportsPKCE() ? oidc.randomPKCECodeVerifier() : null;
      const params = {
        redirect_uri: provider.redirectUri,
        scope: 'openid profile email',
        state, nonce,
      };
      if (verifier) {
        params.code_challenge_method = 'S256';
        params.code_challenge = await oidc.calculatePKCECodeChallenge(verifier);
      }
      return { location: oidc.buildAuthorizationUrl(config, params).href, nonce, verifier };
    },
    async verify(callback, attempt) {
      const tokens = await oidc.authorizationCodeGrant(config, callback, {
        expectedState: attempt.state,
        expectedNonce: attempt.nonce,
        pkceCodeVerifier: attempt.code_verifier ?? undefined,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (!claims || claims.iss !== metadata.issuer ||
          typeof claims.sub !== 'string' || !/^[\x21-\x7e]{1,255}$/.test(claims.sub) ||
          (claims.email !== undefined && typeof claims.email !== 'string') ||
          (claims.email_verified !== undefined && typeof claims.email_verified !== 'boolean') ||
          (claims.azp !== undefined && claims.azp !== provider.clientId) ||
          (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== provider.clientId)) {
        throw new Error('Invalid identity claims.');
      }
      return { issuer: claims.iss, subject: claims.sub };
    },
  };
}

function providerClient(provider) {
  if (!cache.has(provider)) {
    cache.set(provider, createProviderClient(provider).catch((error) => {
      cache.delete(provider);
      throw error;
    }));
  }
  return cache.get(provider);
}

module.exports = { enabledProviders, providerClient, createProviderClient };
