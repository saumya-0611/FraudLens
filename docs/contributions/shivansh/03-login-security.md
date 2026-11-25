# Password login, throttling, and lockout

The password endpoint is public, so it must limit repeated guessing and avoid exposing sensitive details about failed sign-in attempts. FraudLens combines throttling by requester with an account-level lock stored in PostgreSQL.

## Implementation

`POST /api/auth/login` validates the username and password shape before lookup. The query binds the username as a SQL parameter. A bcrypt-format check selects either the real credential hash or a fixed bcrypt dummy hash for missing or unusable credentials. The endpoint returns the same `401 INVALID_CREDENTIALS` response for an unknown account, wrong password, locked account, or disabled account. It records the failure through the audit writer. [Login implementation](../../../backend/src/routes/auth.routes.js) · [Input schemas](../../../backend/src/validation/schemas.js)

The login limiter allows ten requests per minute per limiter client. The account lock is separate. An atomic SQL update counts eligible failures and sets a 15-minute lock when the fifth failure is reached. A successful login resets the counter and lock only if the account is active, the stored hash still matches the hash already checked, and there is no live lock. This final predicate handles races with a concurrent password or status change. [Login implementation](../../../backend/src/routes/auth.routes.js) · [Proxy trust](../../../backend/src/middleware/trustedProxy.js)

## Evidence and ownership

Shivansh’s `b2108cd` implemented bcrypt login protections and the session routes. The team integrated these controls with the existing user schema and deployment settings. Tests cover generic failures, the per-minute limit, and session paths. The recorded disposable PostgreSQL run observed five concurrent failures, a lock, and recovery after controlled expiry. [Auth route tests](../../../backend/src/tests/authRoutes.test.js) · [Rate-limit tests](../../../backend/src/tests/authRateLimit.test.js) · [Security evidence](../../../docs/test-reports/security-report.md)

Generic responses and dummy bcrypt work reduce useful enumeration signals. They do not establish identical timing. The in-process limiter depends on correct immediate proxy trust and stays per process. Account lockout also affects legitimate users during a targeted guessing attempt. This contribution does not claim production-wide throttling or MFA for local accounts.
