# GitHub OAuth sign-in

GitHub login adds a provider to the existing FraudLens session system. The application needs a stable GitHub account identifier and a code exchange that is bound to the same browser conversation.

## Protocol integration

The backend requires the three `GITHUB_OAUTH_*` settings, an exact HTTPS callback under `OAUTH_PUBLIC_ORIGIN`, and Secure cookies. The provider uses OAuth authorization code flow with S256 PKCE. It sends the browser to the fixed GitHub authorize endpoint, exchanges the returned code on the backend, then calls GitHub’s authenticated `/user` endpoint. It accepts a positive safe-integer ID and stores the string form under the fixed `https://github.com` namespace. GitHub login and email fields do not determine the local identity or role. [GitHub client](../../../backend/src/auth/githubOAuth.js) · [OAuth routes](../../../backend/src/routes/oauth.routes.js)

The provider requests an empty scope and requires an unscoped bearer token with an expiry of no more than eight hours. Redirects and requests have restrictive settings, including an eight-second timeout on provider requests. The provider token is used in memory for the user lookup. FraudLens then applies its local role policy and issues the existing `fl_token` cookie. The login button is enabled only when backend configuration and GitHub schema checks report ready. [GitHub client](../../../backend/src/auth/githubOAuth.js) · [Additive schema proposal](../../../database/proposals/github-oauth.sql) · [Login page](../../../frontend/src/App.jsx)

## Ownership and evidence

Shivansh restored the provider implementation on the branch that became PR #9 in `a7e5398` and reconciled the button with Amrita’s latest login and product features in `7b03876`. Saumya merged PR #9 and owns hosted credentials and migration execution. Provider and route fixtures cover wrong state, verifier, callback and token responses, malformed IDs, returning identity, role handling, and linkage. Credentialed acceptance must confirm that the approved GitHub application returns an unscoped token with the expiry expected by this client. An ordinary non-expiring response fails the validator. Live consent and callback checks also require a test account and the intended HTTPS ingress. [GitHub provider tests](../../../backend/src/tests/githubOAuth.test.js) · [OAuth routes tests](../../../backend/src/tests/oauthRoutes.test.js) · [Merged PR #9](https://github.com/saumya-0611/FraudLens/pull/9)
