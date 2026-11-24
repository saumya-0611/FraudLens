# FraudLens social authentication rollout proposal

Prepared on 24 November 2026 for review. The feature defaults off. The SQL in [database/proposals/social-oauth.sql](../database/proposals/social-oauth.sql) is a proposal for the database owner. Running it, changing `docs/CONTRACTS.md`, and changing hosting are separate approval steps.

## Proposed contract text

Replace the account-provisioning paragraph in section 2 with the following:

> Administrators can create password accounts through the users API. Public registration through a verified Google or LinkedIn OpenID Connect identity creates an ACTIVE VIEWER with a generated local username and no password credential. Returning users sign in to the local account identified by their verified issuer and subject. Local status and role remain authoritative. An active authenticated user can explicitly link a provider to their account. Email addresses do not authorize linking. Seed users are created by the existing backend seed command using configured passwords.

For sections 3, 8 and 9, add the proposed schema and the following API and audit behavior for owner review.

| Route | Behavior |
|---|---|
| GET `/api/auth/providers` | Reports which providers are configured and have the required database schema. |
| GET `/api/auth/:provider/start` | Starts login or first-time registration for Google or LinkedIn. |
| GET `/api/auth/:provider/callback` | Consumes a browser-bound, single-use attempt. Issues the existing session on successful sign-in. Returns safe errors to the login page. |
| POST `/api/auth/:provider/link` | With an active session and exact first-party Origin, initiates explicit linking. Completion requires the initiating local user and cookie session. |

Registration audits `USER_CREATED` and `LOGIN_SUCCESS`. Returning sign-in audits `LOGIN_SUCCESS`. New links audit `EXTERNAL_IDENTITY_LINKED`. Only the provider name and local account information are recorded. Email, provider subject, authorization codes, and provider tokens stay out of audit details and application error responses.

## Storage and race handling

- `users.password_hash` becomes nullable. A new social account stores NULL. Password login keeps its BCrypt checks and generic failure path. Existing hashes, usernames, IDs, role assignments and related records remain intact. The users API and seed commands still create BCrypt-backed accounts.
- The identity table holds a unique, case-sensitive issuer and subject and a local user foreign key. A local account can link at most one account per issuer. Advisory locking serializes competing callbacks for the same identity. User creation and mapping are in one transaction. A failed mapping rolls back the new user.
- Attempts expire after ten minutes and are consumed with one conditional delete before exchanging the code. State and the browser correlation proof are stored as digests. The short-lived nonce and optional PKCE verifier are held server-side. Other active installations must use the same PostgreSQL database.
- To link an existing account, an authenticated first-party UI may submit a deliberate same-origin POST to the link route and follow its navigation. Linking never replaces the current session or transfers a mapping owned by another user. The login page only initiates social sign-in. A separate account-settings UI and automated unlinking are outside this change. Before an authorized manual unlink, verify the account has another tested provider or password login. Preserve the mapping history and audit the change.

## Provider configuration

Set these variables in the backend environment using a secret store or an ignored local environment file. Use a dedicated OAuth client for each environment.

| Variable | Meaning |
|---|---|
| `SOCIAL_OAUTH_ENABLED` | Set `true` only after approval, migration and ingress verification. Default is off. |
| `OAUTH_PUBLIC_ORIGIN` | Exact browser origin such as `https://fraudlens.example`, with no path or trailing slash. For non-production Google testing, `http://localhost:5173` is supported. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Google web OAuth credentials and exact `<origin>/api/auth/google/callback`. |
| `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_REDIRECT_URI` | LinkedIn web credentials and exact HTTPS `<origin>/api/auth/linkedin/callback`. |
| `COOKIE_SECURE`, `JWT_SECRET`, `WS_ALLOWED_ORIGINS` | Use Secure session cookies for HTTPS, a unique random existing JWT key, and the same public origin for alerts. No separate OAuth signing secret is required. |

Leave all three provider variables empty to disable that provider. Partial credentials or mismatched callback URLs fail startup when social OAuth is enabled. Provider secrets belong only in the backend process. The current Compose file shares an environment file among services, so use scoped injection for release. Replace the existing repository example JWT key, tokens and seed passwords when configuring an environment.

- In Google Auth Platform, configure consent and audience, create a **Web application** OAuth client, and register the exact callback. Restricted/test publishing settings limit the available accounts. Google advertises S256 PKCE. [Google OIDC guide](https://developers.google.com/identity/openid-connect/openid-connect)
- In the LinkedIn Developer Portal, request **Sign In with LinkedIn using OpenID Connect** for the app and add the HTTPS callback in its Auth settings. The configured issuer follows the provider's published discovery document at `https://www.linkedin.com/oauth/.well-known/openid-configuration`, which advertised `https://www.linkedin.com/oauth` during review. The published web metadata did not advertise S256. The implementation uses the documented confidential web token exchange, state, nonce, and signed ID-token validation. Verify the actual ID-token issuer and application access with a credentialed test before release. [LinkedIn OIDC guide](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2) · [LinkedIn web authorization guide](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow)
- Both providers request `openid profile email`. Only issuer and subject survive identity verification. Email claims receive type checks when present. Email can be absent or unverified, and does not determine account identity, admission or role.

## Release and rollback

Keep the browser, API and callbacks on the same public origin, through the existing Vite or Nginx proxy. For HTTPS, use a trusted certificate and add the exact public origin to the alert WebSocket allowlist. The current Vercel configuration rewrites API requests but has no same-origin WebSocket route. Confirm a supported ingress with Saumya before rollout. Configure proxy and observability logs to omit callback query strings and referrers before enabling the providers. OAuth redirects carry short-lived codes in the callback query by protocol.

After explicit migration approval, back up PostgreSQL, review affected users and apply the proposal as a single transaction. Deploy with social OAuth disabled, validate readiness, run the two provider flows with disposable accounts, and then enable approved providers. To roll back, first disable the feature and retain the nullable column and mappings. Existing password users keep access. Social-only users need a verified recovery or continued supported social sign-in. Do not drop mappings, delete social accounts, or restore NOT NULL while accounts still depend on them.

## Local verification and demonstration

```powershell
node --test backend/src/tests/fixtures/oidc.node.cjs
npm.cmd --prefix backend test -- --silent --no-cache
npm.cmd --prefix frontend run build
npm.cmd --prefix backend audit --audit-level=high
npm.cmd --prefix frontend audit --audit-level=high
```

The backend `pretest` hook also runs the real OIDC library fixtures. The tests use controlled provider and repository fixtures for OAuth. They do not apply the proposed migration.

After approval and configuration, start the backend and frontend in separate PowerShell sessions. For a two-provider run, start the approved HTTPS gateway too. Use the existing [Nginx runbook](../deploy/nginx/README.md) for local HTTPS.

```powershell
npm.cmd --prefix backend run dev
```

```powershell
$env:VITE_USE_MOCKS = 'false'
$env:VITE_PROXY_TARGET = 'http://localhost:5000'
npm.cmd --prefix frontend run dev -- --host 127.0.0.1
```

Open the configured public origin, sign in with Google, verify `VIEWER` in the dashboard or the browser's `GET /api/auth/me` response, sign out, then repeat with LinkedIn. Return with each same provider to confirm the same local username. Confirm the password form and dashboard still work.

## Verification on this branch

- Baseline at `ee56384` passed 201 Jest tests and the production frontend build.
- The updated backend passed 215 Jest tests. The OIDC library passed a separate 11-test fixture suite on Node 24 and Node 20, including signature, issuer, audience, nonce, expiry and replay checks. The frontend build passed and both npm dependency audits reported zero vulnerabilities.
- Chrome on loopback exercised both buttons, redirects, session refresh, logout and denied-consent copy using provider and identity-storage fixtures with the original PostgreSQL schema. The same run exercised the real password form, VIEWER restrictions and masked alert WebSocket delivery.
- Real PostgreSQL with the existing schema passed the password login, lockout, role, audit and WebSocket harness. Configured OAuth providers stayed unavailable before the proposed schema exists.
- The proposed SQL was not applied. PostgreSQL tests of the new identity tables and real Google and LinkedIn sign-in remain pending approval and credentials.
