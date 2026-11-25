# Google and LinkedIn sign-in

FraudLens needs to let a browser prove control of a supported provider account and then issue the normal local session. Provider profile data must stay separate from local role assignment.

## Flow and validation

Google and LinkedIn use the authorization code flow and OpenID Connect. The backend accepts provider configuration only when `SOCIAL_OAUTH_ENABLED=true` and required settings match the exact configured callback origin. `/api/auth/providers` checks configuration and the database prerequisites. The frontend enables the corresponding sign-in button from that response. [OIDC provider setup](../../../backend/src/auth/oidc.js) · [OAuth routes](../../../backend/src/routes/oauth.routes.js) · [Login page](../../../frontend/src/App.jsx)

The start route creates random state, a browser correlation cookie and an attempt with a bounded lifetime. At callback it consumes the stored attempt using the state, cookie proof and provider. The backend exchanges the code using `openid-client` and validates the expected nonce, token signature, issuer and client audience before mapping the verified subject. Google uses S256 PKCE through its declared capability. LinkedIn’s configured web metadata uses the confidential exchange and nonce without advertising S256. First registration supplies a local ACTIVE VIEWER account. [OIDC client](../../../backend/src/auth/oidc.js) · [Identity storage](12-oauth-identity-storage.md)

## Ownership, evidence and remaining checks

Shivansh implemented the gated Google and LinkedIn flows in `f0e7e2d` and integrated sign-in with Amrita’s existing interface in `cc6f870`. Saumya owns developer apps, callback origins, migration approval and hosted activation. The OIDC fixtures sign controlled ID tokens and cover audience, signature, expiry and nonce failures. Route tests cover state, denied consent, local roles and account linking. [OIDC fixtures](../../../backend/src/tests/fixtures/oidc.node.cjs) · [OAuth tests](../../../backend/src/tests/oauthRoutes.test.js)

Provider-shaped tests use controlled provider responses. The project’s rollout makes actual Google and LinkedIn app permissions, exact hosted redirects, log redaction and credentialed sign-in separate acceptance checks. Public registration stays gated on environments with shared business data until tenant isolation has been verified. [Rollout proposal](../../../security/social-oauth.md)
