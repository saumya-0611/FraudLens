# FraudLens OAuth provider handoff for Saumya

25 November 2026 IST. This handoff covers Google, LinkedIn and GitHub. The approved staging and production origins, selected ingress, provider applications, and hosted database status are pending confirmation. [Authentication rollout](../security/social-oauth.md) · [Google and LinkedIn activation evidence](../security/oauth-activation.md)

## A. Ownership

| Owner | Responsibilities |
| --- | --- |
| Saumya | Register developer applications, obtain provider approvals, approve HTTPS origins and certificates, verify and migrate staging and production databases, configure backend environment variables and secrets, choose the ingress and callback routing, run real provider acceptance, and authorize production activation or rollback. |
| Shivansh | Maintain authentication and account-linking implementation, run security verification, and maintain the evidence and handoff. |
| Riya | Review shared account API and lifecycle compatibility. |
| Amrita | Review sign-in, error handling and navigation in the existing frontend. |

## B. Developer consoles

Use dedicated applications and test accounts for isolated staging. Use a separate registration for production and review provider organization or audience restrictions. Substitute the approved HTTPS origin exactly, including an explicit port if required.

### Google

1. In Google Auth Platform, configure Branding, Audience and test users as applicable. Use the OpenID Connect identity scopes `openid profile email`.
2. Create a **Web application** OAuth client. Register `<approved-origin>/api/auth/google/callback` under Authorized redirect URIs.
3. Install the client ID and client secret in the backend secret store. Confirm S256 in the approved application's real flow and complete acceptance with a test Google account. [Google OIDC setup](https://developers.google.com/identity/openid-connect/openid-connect#setting-up-oauth-20) · [Consent configuration](https://developers.google.com/workspace/guides/configure-oauth-consent) · [Discovery](https://accounts.google.com/.well-known/openid-configuration)

### LinkedIn

1. In LinkedIn Developer Portal, select the dedicated application. In Products request **Sign In with LinkedIn using OpenID Connect** and confirm access to `openid profile email`.
2. In Auth, register `<approved-origin>/api/auth/linkedin/callback` and retrieve the client ID and secret.
3. Confirm a test LinkedIn member can authorize the application and the real signed token matches the configured issuer. Use the provider's confidential authorization-code flow with browser-bound state and nonce. The current discovery metadata has no S256 capability for this flow. [LinkedIn OIDC](https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/sign-in-with-linkedin-v2) · [Redirect setup](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow) · [Discovery](https://www.linkedin.com/oauth/.well-known/openid-configuration)

### GitHub

1. In GitHub Settings → Developer settings → OAuth apps, create a dedicated **OAuth App** for identity sign-in. Set the approved Homepage URL and register `<approved-origin>/api/auth/github/callback` as the Authorization callback URL. Leave Device Flow disabled.
2. Keep **Expire user access tokens** enabled. Generate the client secret and inject it into the backend with the client ID. Request no identity-adjacent permissions such as email access and no repository, organization or offline access scopes. Use an app without prior broad grants.
3. Use an authorized GitHub.com test account. FraudLens sends an empty scope, requires an unscoped bearer access token expiring within eight hours, and uses the token once for authenticated `GET https://api.github.com/user`. It discards the token response and maps only the numeric ID under the fixed `https://github.com` namespace. Verify actual token expiry and scope behavior before enabling GitHub. [Create an OAuth App](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app) · [Web flow and token expiry](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps) · [Authenticated user API](https://docs.github.com/en/rest/users/users#get-the-authenticated-user)

## C. Backend environment

Replace the placeholder values in the approved backend secret store. Leave all three settings for an unused provider empty. Values for `TRUSTED_PROXY_CIDRS` and the optional unpooled connection come from deployment ownership. Keep `SITE_ADDRESS` in the Caddy service environment when Caddy is selected.

```dotenv
SOCIAL_OAUTH_ENABLED=false
OAUTH_PUBLIC_ORIGIN=https://<approved-host>
COOKIE_SECURE=true
JWT_SECRET=<unique-staging-or-production-secret>
JWT_EXPIRES_IN=2h
DATABASE_URL=<approved-backend-postgresql-url>
DATABASE_URL_UNPOOLED=
WS_ALLOWED_ORIGINS=https://<approved-host>
TRUSTED_PROXY_CIDRS=
GOOGLE_CLIENT_ID=<google-web-client-id>
GOOGLE_CLIENT_SECRET=<google-web-client-secret>
GOOGLE_REDIRECT_URI=https://<approved-host>/api/auth/google/callback
LINKEDIN_CLIENT_ID=<linkedin-client-id>
LINKEDIN_CLIENT_SECRET=<linkedin-client-secret>
LINKEDIN_REDIRECT_URI=https://<approved-host>/api/auth/linkedin/callback
GITHUB_OAUTH_CLIENT_ID=<github-oauth-app-client-id>
GITHUB_OAUTH_CLIENT_SECRET=<github-oauth-app-client-secret>
GITHUB_OAUTH_REDIRECT_URI=https://<approved-host>/api/auth/github/callback
SITE_ADDRESS=<approved-caddy-site-address>
```

The browser build uses `VITE_USE_MOCKS=false`. Keep OAuth secrets out of all frontend variables, browser bundles, logs and source control. `GET /api/auth/providers` reports configured and schema-ready providers. Credential validity requires a completed live flow. [Backend env template](../.env.prod.example) · [Google and LinkedIn validation](../backend/src/auth/oidc.js) · [GitHub validation](../backend/src/auth/githubOAuth.js)

## D. Database rollout and rollback

1. Identify the exact database instance and review its schema and restore plan. Verify both backend connection targets use the intended database. Take and verify a backup before any approved hosted migration.
2. If the social schema has not yet been installed, apply the [Google and LinkedIn migration](../database/proposals/social-oauth.sql) first. It adds the attempt and mapping tables and makes `users.password_hash` nullable. It preserves existing account rows.
3. Apply the [additive GitHub migration](../database/proposals/github-oauth.sql) second. It replaces the two-provider check with a protocol check, allows an absent nonce for GitHub, and requires its S256 verifier. Google and LinkedIn attempts retain required nonces. Existing users, mappings, attempts and sessions are preserved. Compare row counts and structural results before and after. The migration files are approval-only and must be run once in order.
4. If rollout is stopped, clear all three variables for the affected provider or set `SOCIAL_OAUTH_ENABLED=false` and restart through the approved release process. Retain the additive schema, nullable hashes, users and identity mappings so prior social accounts can regain access after recovery. Existing issued JWTs follow the established session policy. Handle any immediate session invalidation through the approved session or account controls. Restore a backup only as part of the approved incident or rollback plan.

Run the structural checks over the verified, read-only connection. Check both target connections if configured.

```sql
BEGIN READ ONLY;
SELECT current_database() AS database_name,
       to_regclass('oauth_identities') AS identities_table,
       to_regclass('oauth_attempts') AS attempts_table;
SELECT table_name, column_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = current_schema()
  AND ((table_name = 'users' AND column_name = 'password_hash')
       OR (table_name = 'oauth_attempts' AND column_name IN ('nonce', 'code_verifier', 'expires_at')));
SELECT conrelid::regclass AS relation, conname, convalidated, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid IN (to_regclass('oauth_identities'), to_regclass('oauth_attempts'))
ORDER BY relation, conname;
ROLLBACK;
```

Expect identity uniqueness by `(issuer, subject)` and `(user_id, issuer)`, a unique state key, a ten-minute attempt expiry, nullable password hashes, and the validated `oauth_attempts_provider_protocol_check` after both migrations.

## E. HTTPS and selected ingress

Use the approved browser origin for the SPA, `/api/*` and all callbacks. Confirm trusted TLS and Secure, HttpOnly, SameSite=Lax session cookies, exact Origin for explicit linking and the configured alert Origin. Limit trusted proxy CIDRs to verified immediate ingress peers. Check log redaction at every layer using synthetic markers for codes, state, cookies, tokens and referrers on success and error paths.

| Ingress | Configuration to verify |
| --- | --- |
| Caddy | Set `SITE_ADDRESS` to the confirmed site. Verify trusted HTTPS, `/api/*` backend routing, and `/ws/*` upgrades. Load the branch's access and runtime log filters and rerun the callback error-path probe. [Caddy config](caddy/Caddyfile) · [Caddy runbook](SINGLE_VM_CADDY.md) |
| Nginx | Install the approved certificate and hostname. Keep API/callback and WebSocket routing same-origin. Configure callback query and credential redaction for access and error logs before sending real codes through its request-line logging path. [Nginx config](nginx/nginx.conf) · [Nginx runbook](nginx/README.md) |
| Vercel/Render | Set the approved frontend HTTPS origin in the backend and route all `/api/*` calls to the isolated backend, including callback paths. Verify cookie behavior and logging controls on both platforms. The checked-in Vercel rewrite covers API traffic. Validate the chosen alert transport separately. [Frontend rewrites](../frontend/vercel.json) · [Cloud runbook](CLOUD_DEPLOYMENT.md) |

## F. Independent provider acceptance

Run each column against the actual approved origin with the provider's test application and real test account. Users enter credentials or MFA directly in the browser. Record provider, redacted ID, status, local role and audit result. Keep raw profile data, codes, tokens, browser cookies and secrets out of evidence.

| Acceptance check | Google | LinkedIn | GitHub |
| --- | --- | --- | --- |
| First verified sign-in creates one ACTIVE VIEWER with no password | PENDING | PENDING | PENDING |
| Returning and parallel sign-ins use the original user ID | PENDING | PENDING | PENDING |
| `/api/auth/me` and cookie attributes are correct, logout clears the browser session | PENDING | PENDING | PENDING |
| Disabled user and prior session are denied | PENDING | PENDING | PENDING |
| Exact-origin explicit linking works, cross-account conflicts and email-based linking are denied | PENDING | PENDING | PENDING |
| Provider profile cannot grant ADMIN/ANALYST, established password login still works | PENDING | PENDING | PENDING |
| Consent denial and callback errors render safe messages and create no user | PENDING | PENDING | PENDING |
| Audit events are correct and the ingress omits sensitive values | PENDING | PENDING | PENDING |

The local HTTPS harness exercised production routes and storage against disposable PostgreSQL and used mocked provider HTTP responses. Chrome rendered three enabled buttons and denied-consent copy. Both migrations ran in that fixture, and the pre-existing OIDC attempts and identity mapping survived. [Three-provider harness](../security/verify-oauth.cjs) · [Disposable setup](../security/oauth-activation.md#reproduce-the-disposable-https-verification)

## G. Release gates

Saumya approves the selected origin, ingress, database change and rollback. Complete credentialed acceptance independently for each provider before enabling it. Public registration remains disabled on shared environments until tenant isolation and authorization are verified. [Tenant isolation proposal](../security/phase3-security-design.md)

## H. Final status

| Provider | Implementation | Local Tests | Developer Setup | Live Tests | Production Status |
| --- | --- | --- | --- | --- | --- |
| Google | Existing OIDC | PASS · signed token and disposable HTTPS/PostgreSQL fixtures | PENDING | PENDING | PENDING · gate off |
| LinkedIn | Existing OIDC | PASS · independent signed token and disposable HTTPS/PostgreSQL fixtures | PENDING | PENDING | PENDING · gate off |
| GitHub | OAuth App with S256 and numeric identity | PASS · token/user fixtures and disposable HTTPS/PostgreSQL | PENDING | PENDING | PENDING · gate off |
