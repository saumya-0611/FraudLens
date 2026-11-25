# OAuth identity persistence and explicit linking

Two users can share a displayed email or a provider username can change. FraudLens maps a provider’s verified stable identifier to a local account and treats linking as a separate, authorized action.

## Storage and concurrency

The base OAuth proposal creates `oauth_identities` with a primary key on `(issuer, subject)` and a uniqueness constraint on `(user_id, issuer)`. Password hash nullability permits a social account without a password. A second proposal extends `oauth_attempts` for GitHub. It preserves required OIDC nonces and requires a valid stored S256 verifier for GitHub attempts. [Base migration](../../../database/proposals/social-oauth.sql) · [GitHub migration](../../../database/proposals/github-oauth.sql)

Attempts store hashes of state and browser proof and expire after ten minutes. A conditional delete consumes one matching, live attempt, so duplicate callbacks cannot both redeem it. The identity store uses a transaction and a per-identity advisory lock to serialize first registration. Unique database keys backstop the lookup. The store inserts the user and mapping together, so a failed mapping rolls back the user creation. [OAuth store](../../../backend/src/auth/oauthStore.js)

Linking begins with an authenticated same-origin POST. The attempt carries the initiating local user ID and a hash of the current session cookie. Callback revalidates both. A mapping owned by another local account produces a conflict, and disabled local users cannot complete authentication or a new link. Returning identity matches use the current local role. [OAuth routes](../../../backend/src/routes/oauth.routes.js) · [OAuth store](../../../backend/src/auth/oauthStore.js)

Shivansh contributed this design and implementation through `f0e7e2d` and the GitHub extension in `a7e5398`. Saumya owns migration deployment. The store and route fixtures cover concurrent resolution, rollback, replay and mismatched linking. Schema proposals alone do not show that a hosted database has migrated. Operational rollback disables provider entry points while retaining mappings and existing accounts. [Store tests](../../../backend/src/tests/oauthStore.test.js) · [Route tests](../../../backend/src/tests/oauthRoutes.test.js) · [Rollout proposal](../../../security/social-oauth.md)
