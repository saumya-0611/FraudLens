# Shivansh

Cyber security. Owns authentication, role enforcement, OAuth readiness, and security checks for alerts and masked account data.

## P0

### S1

- [x] **Verify transaction and alert access for the demo roles** · Passed the disposable PostgreSQL role matrix and authenticated alert checks on 25 November 2026.
- **Goal** — Verify existing cookie and service-ingestion boundaries for the new UI flow. Keep POST limited to ADMIN or the configured service identity, keep alert REST operations limited to ADMIN and ANALYST, and verify permitted users receive masked data on transaction reads and authenticated alert events.
- **Files** — `backend/src/middleware/serviceAuth.js`, `backend/src/routes/alerts.routes.js`, `backend/src/websocket/alertSocket.js` if a regression is found, and `backend/src/tests/protectedRoutes.test.js`, `backend/src/tests/alerts.test.js`, `backend/src/tests/alertSocket.test.js` for coverage.
- **Dependencies** — Riya [R1](riya.md#r1) supplies readback cases. Coordinate actual role checks with Amrita [A1](amrita.md#a1) and Lead [L2](lead.md#l2) without waiting for the full demo rehearsal.
- **Acceptance** — Run `npm.cmd --prefix backend test -- --runTestsByPath src/tests/protectedRoutes.test.js src/tests/alerts.test.js src/tests/alertSocket.test.js`. Repeat the role matrix on an approved disposable loopback instance using synthetic accounts: unauthenticated requests return `401`; ANALYST/VIEWER POST return `403`; ADMIN and the configured service identity can submit valid payloads; VIEWER alert REST calls return `403`; ADMIN/ANALYST can review a real high-risk alert. Confirm masked account data on authorized reads and authenticated alert events. Keep test evidence free of credential values.
- **Evidence** — Contract §§2 and 8 define role rules and masking. Service auth and targeted route tests already exercise several denial cases with fixtures. [Role matrix](../docs/CONTRACTS.md#L45) · [Service auth](../backend/src/middleware/serviceAuth.js#L1) · [Protected tests](../backend/src/tests/protectedRoutes.test.js#L70) · [Baseline](STATUS.md#offline-checks)

## P1

### S2

- [ ] **Validate readiness of the existing social sign-in** · The schema migration and local OIDC fixtures passed. Approved provider applications and credentialed staging checks are still needed.
- **Goal** — Verify Google and, if approved for the demo, LinkedIn on the existing flow. Confirm provider availability reflects configuration and schema readiness. Keep password login usable and preserve local role authority.
- **Files** — `security/social-oauth.md`, `database/proposals/social-oauth.sql` for review, `backend/src/tests/oauthRoutes.test.js`, and `backend/src/tests/oauthStore.test.js` if additional coverage is needed.
- **Dependencies** — Lead supplies a disposable database and approved callback origin. Amrita verifies the sign-in buttons reflect `/api/auth/providers`. The project owner configures the approved provider test application.
- **Acceptance** — Run `npm.cmd --prefix backend test -- --runTestsByPath src/tests/oauthRoutes.test.js src/tests/oauthStore.test.js`. On the separately approved test origin and database, verify first sign-in creates an active VIEWER, repeat sign-in maps to the same local user, logout clears the session, and disabled or unconfigured providers remain unavailable. Record provider names and outcomes with credential values omitted. Approve each provider independently based on its own run.
- **Evidence** — The repo has Google and LinkedIn OIDC with browser-bound state, nonce, and S256 for Google. The saved evidence reports fixture coverage and pending credentialed verification and SQL approval. [Auth routes](../backend/src/routes/oauth.routes.js#L12) · [OIDC configuration](../backend/src/auth/oidc.js#L3) · [Saved evidence](../security/social-oauth.md#L77)

### S3

- [x] **Require explicit credentials in deployment and proof scripts** · Passed validation fixtures, a read-only disposable PostgreSQL check, and both explicitly configured Kafka runtimes on 25 November 2026.
- **Goal** — Require explicitly configured credentials for the named runtime and proof paths, with clear safe failure on missing configuration. Make live-check scripts refuse a non-approved target. Coordinate the names and defaults with Lead before changing the launch path.
- **Files** — `streaming/jobs/pipeline.py`, `scripts/test_app_live.js`, `scripts/verify_neon_e2e.js`, and `deploy/CLOUD_DEPLOYMENT.md` if the operator instructions need updating.
- **Dependencies** — Lead [L3](lead.md#l3) owns the streaming ML request changes. Coordinate edits to the same function with Lead.
- **Acceptance** — In isolated local runs with the required variables unset, each changed entry point exits nonzero with a configuration error before any connection or write. With a synthetic configuration aimed at an approved disposable instance, run the documented positive-path command and verify normal operation. Record exit codes, configured variable names, and which targets were accepted with values omitted.
- **Evidence** — The streaming ML request and two existing verification scripts have configured-value fallbacks. The scripts start a backend or write to a database, so their results need an explicit target. [Streaming request](../streaming/jobs/pipeline.py#L113) · [Backend proof script](../scripts/test_app_live.js#L32) · [Database proof script](../scripts/verify_neon_e2e.js#L37)

## P2

### S4

- [ ] **Scope a GitHub sign-in option** · Blocked by S2 and selection of a post-demo auth scope.
- **Goal** — Document the work required to add GitHub using the existing local session and role model. Specify provider-console steps, configuration names, exact callback path, and identity mapping requirements for owner review.
- **Files** — `security/social-oauth.md`.
- **Dependencies** — Complete [S2](#s2) first. Review UI availability with Amrita and exact callback origin with Lead.
- **Acceptance** — Review the proposal against the current official GitHub provider documentation and existing provider tests. Record the chosen protocol, stable identity key, minimal scope, callback validation and replay checks, first-login VIEWER mapping, and the test cases needed before enabling it. Obtain the owner's scope decision and record it on the board.
- **Evidence** — Current provider allowlist and provider client contain Google and LinkedIn. The supplied Phase 1 brief requests a GitHub sign-in proposal. [Provider allowlist](../backend/src/routes/oauth.routes.js#L15) · [Provider client](../backend/src/auth/oidc.js#L3) · [Local role rules](../security/social-oauth.md#L9)
