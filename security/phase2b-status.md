# FraudLens Phase 2b security evidence

24 November 2026 IST. Candidate task-board updates for Saumya and the owners.

## Git reconciliation

| Ref | Commit at fetch |
| --- | --- |
| origin/main | ed73a51bf52fa9728a008456fbd2b752e3c608d7 |
| origin/dev and Phase 2b base | 8aae93cc9c75435633280181f75db5ca334247b9 |
| Original checkout and origin/shivansh/social-oauth | cc6f87053fc18b296de5b260dc0b3d2a8df99306 |

After fetching, the original checkout was 14 commits behind dev with zero commits ahead. The merge-base-to-original diff was empty. Main was one commit ahead of dev with five task-board additions. The separate Phase 2b worktree starts at dev. The original untracked handoff file retained its SHA-256. Read the latest board directly with `git show origin/main:tasks/STATUS.md` and `git show origin/main:tasks/shivansh.md`.

## Proposed task-board entries

| Task | Status | Evidence and next owner |
| --- | --- | --- |
| S1 · Role and masking checks | Unverified | Targeted fixtures passed. Shivansh needs approval for the disposable role matrix. Riya's readback cases and Amrita's browser walkthrough are still pending. |
| S2 · Google and LinkedIn | Blocked | OIDC and store fixtures passed. Saumya must approve the disposable migration and callback origin. The provider app owner must supply approved test apps and test accounts. Verify the providers independently. |
| S3 · Explicit runtime and proof credentials | Unverified | The HTTP and PostgreSQL probes reject unsafe targets and use read-only operations. Refusal checks and a loopback HTTP fixture passed. Real PostgreSQL proof awaits approval. Saumya owns streaming and Riya/Saumya need to resolve startup credential and seed behavior. |
| S4 · GitHub scope and Phase 3 design | Blocked | The [Phase 3 security design](phase3-security-design.md) is ready for review. The GitHub option still requires S2 acceptance and a scope decision from Saumya. |

## S1 · Access matrix

| Case | Current evidence |
| --- | --- |
| Anonymous transaction list, detail and POST | HTTP fixture returns 401. [Protected routes](../backend/src/tests/protectedRoutes.test.js#L35) |
| ANALYST or VIEWER transaction POST | HTTP fixtures return 403 before ingestion. [Protected routes](../backend/src/tests/protectedRoutes.test.js#L53) |
| ADMIN or configured service token | HTTP fixtures return 202 and invoke the mocked producer. An invalid token without a session is 401. The invalid token does not replace the normal ADMIN cookie path. [Protected routes](../backend/src/tests/protectedRoutes.test.js#L70) · [Service path](../backend/src/tests/transactions.test.js#L22) |
| VIEWER alert REST and authorized investigation | VIEWER list and update return 403. ANALYST list passes and returns a mask. ADMIN and ANALYST can each move a NEW alert to UNDER_REVIEW with fixture data. [Protected routes](../backend/src/tests/protectedRoutes.test.js#L65) · [Alerts](../backend/src/tests/alerts.test.js#L15) |
| Transaction and alert masking | List/detail fixtures verify masked values and omission of raw account references. The WebSocket serializer recursively removes nested account_ref and preserves dates. [Transactions](../backend/src/tests/transactions.test.js#L46) · [Masking](../backend/src/utils/mask.js#L11) |
| WebSocket origin and session | Tests use real loopback WebSocket framing and a mocked database. Exact configured origins are accepted with valid active sessions. Missing or foreign origins fail at upgrade. Disabled or invalid sessions close with 4401. Disabling an open connection prevents subsequent alert delivery. [Socket tests](../backend/src/tests/alertSocket.test.js#L74) · [Origin config](../backend/src/middleware/browserRequest.js#L18) |
| Disabled account with existing cookie | The HTTP authorization middleware reloads the user and denies inactive status. Its fixture verifies denial using an otherwise valid cookie. [Middleware](../backend/src/middleware/authenticate.js#L15) · [Test](../backend/src/tests/authMiddleware.test.js#L126) |

The runtime matrix still needs anonymous, all three cookie roles, valid and invalid service tokens, a persisted masked read, a high-risk alert review, and a socket opened from the configured browser origin. Use synthetic accounts and records. A fixture 202 confirms request acceptance and says nothing about persistence or inference.

## S2 · OAuth readiness

- The gated Google and LinkedIn routes check that both OAuth tables exist and the password hash column is nullable. Both base initializers still require a password hash and omit the two OAuth tables. The proposal is marked approval-only. Hosted database migration status remains unknown. [Readiness check](../backend/src/auth/oauthStore.js#L4) · [Base schema](../database/init.sql#L4) · [Bootstrap](../backend/scripts/bootstrapSchema.js#L5) · [SQL proposal](../database/proposals/social-oauth.sql#L1)
- The configured public origin determines the exact callbacks at `/api/auth/google/callback` and `/api/auth/linkedin/callback`. Use HTTPS and secure cookies for deployed origins. The state is single-use and browser-bound, the ID token is nonce-bound, and Google uses S256. LinkedIn uses the confidential web exchange and signed ID-token validation. The fixture represents current LinkedIn PKCE capability as absent. Session cookies reuse the existing HttpOnly and SameSite=Lax behavior. [Provider config](../backend/src/auth/oidc.js#L21) · [Callback](../backend/src/routes/oauth.routes.js#L98) · [Session](../backend/src/auth/session.js#L4)
- The store serializes each issuer/subject, reuses existing identities, and creates new ACTIVE VIEWER accounts with a null password hash. It blocks disabled users and requires an active session for explicit linking. Email supplies neither linkage nor local role authority. Password login still uses its own credential path. [Identity store](../backend/src/auth/oauthStore.js#L38) · [Link and callback](../backend/src/routes/oauth.routes.js#L64) · [Password login](../backend/src/routes/auth.routes.js#L46)
- After approval, check absence before migration and presence after migration. Verify single-use expiry, concurrent callbacks and mapping uniqueness against disposable PostgreSQL. On the approved HTTPS origin, run first sign-in, return sign-in, disabled-account denial, password login and logout, independently for each provider. Keep the gate off until that provider's checks pass. Roll back by disabling the provider while retaining mappings and nullable hashes. [OAuth rollout](social-oauth.md#release-and-rollback)

## S3 · Credential and scoring findings

| Owner | Finding and smallest safe follow-up |
| --- | --- |
| Shivansh | The original HTTP probe loaded root environment settings, started the backend, used seed and service defaults and submitted a transaction. The original database probe read account data, created a transaction, score and alert, changed alert state and fabricated an audit entry. The replacement HTTP probe makes four anonymous GETs against an explicitly configured numeric loopback origin and rejects redirects. The database probe requires its own explicit loopback URL and a matching named disposable database, reads schema metadata in a read-only transaction and rolls back. Both report fixed, redacted errors. [HTTP proof](../scripts/test_app_live.js#L1) · [Database proof](../scripts/verify_neon_e2e.js#L1) · [Target validation](../scripts/proofConfig.js#L1) |
| Saumya · Streaming and deployment | The worker supplies a literal internal token and a local PostgreSQL URL with credentials when variables are missing. Decide startup validation for both streaming entry points so required configuration fails before Kafka, ML or PostgreSQL access. Remove the fallbacks in the same change and add no-connect regression checks. Replace usable seed/token examples with clearly marked placeholders and rotate any defaults that were ever deployed. [Worker](../streaming/jobs/pipeline.py#L108) · [Examples](../.env.example#L1) · [Deployment instructions](../deploy/CLOUD_DEPLOYMENT.md#L37) |
| Riya and Saumya · Backend startup | Backend env requires a database URL and JWT secret outside tests. The optional unpooled URL uses the operator-provided pooled URL, and the ML service URL has a loopback default. Shared config checks presence of the DB URL but does not validate its format here. Confirm explicit parameters for the modes that use service ingestion or ML. The existing seed regression is a release blocker. Startup invokes seeding, which can use public defaults and reset an existing username's password, role and status. Startup also deletes users with non-null password values that fail a prefix check. Require explicit credentials for missing accounts, use conflict-do-nothing, and remove account deletion from normal startup. Review affected environments using approved access and logs. [Env](../backend/src/config/env.js#L8) · [Startup](../backend/src/server.js#L20) · [Seed](../backend/scripts/seed.js#L15) · [Failed assertions](../backend/src/tests/seed.test.js#L23) |
| Saumya L1/L3 and Riya R1/R2 · Scoring | Source still initializes an inline score to 0.01 and can persist a LEGITIMATE result after failed or incomplete inference. A duplicate insert can skip the existing score and still reach alert creation based on the current attempt. The streaming parser still defaults absent model versions to v1. Preserve a durable unscored PENDING row, validate inference, create alerts only from a committed winning score, and keep Kafka/Spark proof separate. No scoring runtime was executed on this branch. [Inline score](../backend/src/pipeline/inlineScorer.js#L166) · [Retry and alert](../backend/src/pipeline/inlineScorer.js#L223) · [Streaming parser](../streaming/jobs/pipeline.py#L108) · [Readback contract](../docs/CONTRACTS.md#L319) |

## Verification recorded on the dev-based worktree

| Evidence | Command | Result |
| --- | --- | --- |
| Proof fixtures | `node --test scripts/proofScripts.test.cjs` | Exit 0. Three tests passed. Guarded child processes reject missing and invalid settings before fetch or socket connect. A local HTTP fixture confirms four anonymous GETs. |
| Targeted API, WS and OAuth | `$env:PIPELINE_MODE='kafka'` then `npm.cmd --prefix backend test -- --runTestsByPath src/tests/protectedRoutes.test.js src/tests/alerts.test.js src/tests/alertSocket.test.js src/tests/transactions.test.js src/tests/authMiddleware.test.js src/tests/authRoutes.test.js src/tests/oauthRoutes.test.js src/tests/oauthStore.test.js` | Exit 0. 109 Jest tests in eight suites and 11 OIDC library fixtures passed. |
| Full backend regression | `$env:PIPELINE_MODE='kafka'` then `npm.cmd --prefix backend test -- --silent` | Exit 1. 213 passed and three failed across 21 suites. All three failures are in seed.test.js. The 11 OIDC pretests passed. |
| Focused baseline seed regression | `npm.cmd --prefix backend test -- --silent --runTestsByPath src/tests/seed.test.js` | Exit 1. The same three failures reproduced. The seed implementation and seed tests match the dev base. |
| Frontend lint and build | From frontend, `npm.cmd run lint` and `$env:VITE_USE_MOCKS='false'` followed by `npm.cmd run build -- --outDir $outDir` with a fresh temporary directory | Both exited 0. The production bundle built with Vite and used a scratch output directory. |
| Disposable PostgreSQL and browser | No commands run against a database or real browser | NOT RUN. Docker responded to inspection. Approval for a disposable runtime and separate approval for the OAuth proposal remain pending. |
| Real Google and LinkedIn providers | No credentials or test accounts supplied | NOT RUN for each provider. Fixture ID tokens are signed by test keys. |
| Hosted or full-stack pipeline | No hosted requests, Kafka/Spark job or real ML inference | NOT RUN. Requires owner fixes and a separately approved runtime. |

## Local demonstration

Run from the Phase 2b worktree root in PowerShell. The first block can run offline after installing the lockfile dependencies.

```powershell
npm.cmd ci --prefix backend --no-audit --no-fund
$env:PIPELINE_MODE = 'kafka'
node --test scripts/proofScripts.test.cjs
npm.cmd --prefix backend test -- --runTestsByPath src/tests/protectedRoutes.test.js src/tests/alerts.test.js src/tests/alertSocket.test.js src/tests/oauthRoutes.test.js src/tests/oauthStore.test.js
```

For the PostgreSQL read-only check, wait for approval and start a fresh container with only the baseline schema. The flags below bind Docker's mapped port to loopback. The password is generated in the shell. Keep the URL off screen.

```powershell
$proofName = 'fraudlens-proof-' + [guid]::NewGuid().ToString('N')
$proofDatabase = 'fraudlens_proof_phase2b'
$proofPassword = [guid]::NewGuid().ToString('N')
$proofSchema = (Resolve-Path 'database/init.sql').Path
docker run --rm -d --name $proofName -e "POSTGRES_PASSWORD=$proofPassword" -e "POSTGRES_DB=$proofDatabase" -p 127.0.0.1::5432 --mount "type=bind,source=$proofSchema,target=/docker-entrypoint-initdb.d/10-init.sql,readonly" postgres:16
docker exec $proofName pg_isready -h 127.0.0.1 -U postgres -d $proofDatabase
$proofPort = ((docker port $proofName 5432/tcp | Select-Object -First 1) -split ':')[-1]
$env:FRAUDLENS_PROOF_DATABASE = $proofDatabase
$env:FRAUDLENS_PROOF_DATABASE_URL = "postgresql://postgres:${proofPassword}@127.0.0.1:${proofPort}/$proofDatabase"
node scripts/verify_neon_e2e.js
```

Repeat `pg_isready` until ready before running the probe. The expected base-schema output is `OAuth schema prerequisites present: no.`. Only after separate SQL approval for that container, pipe `Get-Content -Raw database/proposals/social-oauth.sql` to `docker exec -i $proofName psql -X -v ON_ERROR_STOP=1 -U postgres -d $proofDatabase` and run the probe again. The expected structural check is `yes`.

For anonymous HTTP proof, run the command below in a second shell once the approved loopback backend is listening. Use the exact bound port. The probe starts no server and performs no login, logout or transaction submission.

```powershell
$env:FRAUDLENS_PROOF_ORIGIN = 'http://127.0.0.1:5000'
node scripts/test_app_live.js
```

Use the [existing disposable role and browser runbook](attack_tests/README.md) for the active-session checks after runtime approval. Use its separate database names and explicitly set `DATABASE_URL_UNPOOLED` to the same disposable URL to keep both pools in the fixture. Use the runbook's dedicated local harness, which loads the app without the normal startup bootstrap. The PostgreSQL harness writes synthetic data and verifies the application's actual audit hash chain. The browser harness uses provider fixtures. Complete the manual ADMIN and service ingestion checks with the approved pipeline when Riya and Saumya are ready.

Stop only the named container created by the commands and clear this shell's proof variables.

```powershell
docker stop $proofName
Remove-Item Env:FRAUDLENS_PROOF_DATABASE,Env:FRAUDLENS_PROOF_DATABASE_URL,Env:FRAUDLENS_PROOF_ORIGIN -ErrorAction SilentlyContinue
```
