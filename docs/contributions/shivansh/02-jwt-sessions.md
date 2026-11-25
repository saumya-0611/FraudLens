# JWT session security

FraudLens needs to recognize browser sessions across requests and the alert socket. A session token must prove its integrity, expire, and identify a user whose account is still active.

## Implementation

- `signToken` signs with HS256, puts the local user ID in `sub`, and includes the username and role. The default expiration is two hours. Signing and verification require a configured `JWT_SECRET` of at least 32 characters under the current guard. [JWT implementation](../../../backend/src/utils/jwt.js)
- `verifyRequestCookie` reads exactly one `fl_token` cookie. It verifies the signature with an HS256 allowlist and requires a valid expiry, positive safe integer user ID, string username and recognized role. Missing, duplicate, expired or invalid tokens result in an unauthenticated request. [JWT implementation](../../../backend/src/utils/jwt.js)
- The session helper applies `HttpOnly`, `SameSite=Lax` and `Path=/`. `COOKIE_SECURE=true` enables the Secure attribute for HTTPS. Cookie lifetime is derived from the signed token lifetime. Logout clears the browser cookie with the same options. [Session helper](../../../backend/src/auth/session.js) · [Auth routes](../../../backend/src/routes/auth.routes.js)

The token's role is a signed claim. Every protected request resolves the active account and its current role from PostgreSQL before authorization. The same lookup is reused by alerts. This allows a disabled account to lose access while a previously issued JWT still has time remaining. [Session middleware](../../../backend/src/middleware/authenticate.js)

## Evidence and limits

Shivansh implemented signing and verification in `1ca5d7b` and hardened role enforcement in `f5d6f81`. The shared auth integration handles cookie issuance from both password and provider sign-in. The JWT tests verify expiry, tampering, unsigned and alternate-algorithm tokens, and duplicate cookies. The auth route tests cover session issuance and logout. [JWT tests](../../../backend/src/tests/jwt.test.js) · [Auth route tests](../../../backend/src/tests/authRoutes.test.js)

Logout clears this browser's cookie. The source has no per-token revocation list, so separately retained copies can remain valid until expiry, account disablement, or key rotation. HTTPS, shared key management across replicas, and ingress behavior depend on the deployed environment. [Secrets policy](../../../security/secrets-policy.md)
