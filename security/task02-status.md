# FraudLens Task 02 security evidence

25 November 2026 IST. Release-stabilization started at `e2cebc17160ef20fc48b15179edb66b8c07f32ec`. Fresh refs were `origin/dev` at `8aae93c` and `origin/main` at `ed73a51`. The table supplies candidate updates for the main task board.

| Item | Status | Evidence |
| --- | --- | --- |
| S1 · Role and masking checks | Pass on the disposable stack | Node backend, PostgreSQL 16, real WebSocket clients and headless Chrome. The inline pipeline used a loopback HTTP inference fixture. |
| S3 · Explicit runtime and proof credentials | Pass on the disposable stack | HTTP and PostgreSQL proof scripts passed their negative and positive checks. Streaming requires explicit `DATABASE_URL` and `INTERNAL_ML_TOKEN`. The direct worker batch passed over real PostgreSQL and loopback HTTP. |
| C12 · Defensive security verification | Requested cases passed | Runtime results below. The unsigned-JWT rejection is covered by the Jest fixture. SQL runtime checks covered malformed filter shapes and privacy-safe search. |
| C13 · Demo | Local rehearsal passed | The live PostgreSQL/REST/WebSocket harness completed in 2.2 seconds on this machine after setup. The [two-minute presentation guide](demo-guide.md) maps its output to the four demo points. |
| S2 · Task 03 OAuth activation | Ready to begin preparation. Activation gated | The baseline PostgreSQL proof reported that OAuth schema prerequisites were absent. Activation still requires explicit SQL approval, an approved callback origin, approved provider apps, and a real test for each provider. [OAuth rollout](social-oauth.md) |

## Runtime observations

- Anonymous transaction list, detail, submission and alert list returned `401`. VIEWER and ANALYST submissions returned `403`. Their user-management and retrain calls returned `403`. A wrong service token returned `401`. ADMIN and the configured service identity each received `202` with the accepted ID. An independent check observed both IDs at the ML fixture and read back persisted scores and alerts. [Runtime harness](verify-postgres.cjs)
- VIEWER could read masked transaction list/detail and could not list or update alerts. ADMIN and ANALYST could list masked alerts. ANALYST moved a persisted alert to `UNDER_REVIEW` and ADMIN resolved it. Search accepted the ID or account suffix, while searching for the raw account reference returned zero rows. Nested reason metadata kept its weight and omitted the account reference.
- An allowed-origin VIEWER socket with a current session received two masked alerts. A foreign-origin handshake received `403`. A socket without a session closed with `4401`. After disabling a user, REST returned `401` and the open socket closed with `4401` before another event could be delivered.
- A modified session signature and a genuinely expired signed fixture both returned `401`. Unexpected filter shape, invalid risk and invalid date returned `400`. Malformed JSON returned `400` and an oversized JSON body returned `413`. The error responses carried request IDs. Five concurrent failed logins locked the synthetic account for 15 minutes. The correct password was denied while locked, then accepted after simulated expiry. Login failures for unknown and known users had the same public message, and exceeding the request quota returned `429`.
- The audit CLI verified 38 intact rows, including twelve concurrent fixture appends. The production verifier function detected an entry-hash mismatch in a fixture row changed within a transaction. Rollback restored every row exactly. The CLI then verified the original chain again. [Verifier](../backend/scripts/verify_audit_chain.js#L5)
- Chrome exercised password sign-in, protected navigation, logout, cookie flags, VIEWER denial in the UI and API, masked transaction reads, and masked alert delivery over a real WebSocket with a synthetic event. The browser ran over loopback HTTP. [Browser harness](verify-browser.cjs)
- The existing HTTP proof sent four anonymous GETs and passed against the real disposable backend. The PostgreSQL proof reported a read-only transaction and valid baseline schema. Before and after the PostgreSQL probe, users, transactions, scores, alerts and audits each contained zero rows. Guarded tests reject missing, malformed and non-loopback settings before socket or fetch calls. [Proof tests](../scripts/proofScripts.test.cjs)
- With environment reads unset, the old streaming code reached intercepted database and ML call sites using built-in credentials. Both entry points now fail on missing configuration before starting Kafka or Spark. A real direct Python batch against disposable PostgreSQL and a loopback HTTP fixture sent the configured token and used the configured base path. The synthetic result persisted as `LEGITIMATE` with the fixture model version. ML model inference, Kafka/Spark delivery, hosted ingress and live OAuth providers remain outside this run. [Worker](../streaming/jobs/pipeline.py#L30)

## Commands and results

Run from the worktree root. Node 24, PostgreSQL 16 in Docker, Chrome headless and Python 3.11 were used.

| Evidence | Command | Result |
| --- | --- | --- |
| Targeted backend | `npm.cmd --prefix backend test -- --silent jwt.test.js authMiddleware.test.js authRoutes.test.js authRateLimit.test.js protectedRoutes.test.js apiHardening.test.js securityAdmin.test.js securityValidation.test.js auditIntegrity.test.js alertSocket.test.js transactions.test.js alerts.test.js` | Exit 0. 160 Jest tests in 13 suites and 11 OIDC pretests passed. |
| Proof fixtures | `node --test scripts/proofScripts.test.cjs` | Exit 0. 3 passed. |
| Full backend | `npm.cmd --prefix backend test -- --silent` | Exit 0. 229 Jest tests in 22 suites and 11 OIDC pretests passed. |
| Standalone OIDC fixtures | `node --test backend/src/tests/fixtures/oidc.node.cjs` | Exit 0. 11 passed. |
| Streaming and feature tests | `python -B -m pytest -p no:cacheprovider -q -rs streaming/tests shared/tests` | Exit 0. 19 passed, one skipped because `fraudTrain.csv` was unavailable. Streaming-only run passed 13 tests. |
| Frontend | `npm.cmd --prefix frontend run lint` and `$env:VITE_USE_MOCKS='false'` followed by `npm.cmd --prefix frontend run build` | Both exited 0. |
| Disposable runtime | `node scripts/verify_neon_e2e.js`, `node security/verify-postgres.cjs` and `node security/verify-browser.cjs` with the setup below | Exit 0. HTTP proof ran inside the PostgreSQL rehearsal. The separate direct-batch streaming smoke passed in the same disposable container before cleanup. |
| Whitespace | `git diff --check` | Exit 0. |

### Disposable runtime setup

Install backend and frontend lockfile dependencies. Run the frontend build above before the browser check. Use a fresh PowerShell session for the following commands.

```powershell
$id = [guid]::NewGuid().ToString('N').Substring(0,16)
$name = 'fraudlens-task02-' + $id
$pgDb = 'fraudlens_phase2_verification_' + $id
$browserDb = 'fraudlens_phase2_browser_' + $id
$proofDb = 'fraudlens_proof_' + $id
$env:POSTGRES_PASSWORD = [guid]::NewGuid().ToString('N')
$env:SOCIAL_OAUTH_ENABLED = 'false'
$env:DATABASE_SSL = 'false'
$env:FRAUDLENS_TASK02_PROBES = 'true'
$env:FRAUDLENS_CAPTURE_EVIDENCE = '0'
$env:FRAUDLENS_HTTPS_OPENSSL = ''
$env:FRAUDLENS_CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
docker run --pull=never --rm -d --name $name -e POSTGRES_PASSWORD -e "POSTGRES_DB=$pgDb" -p 127.0.0.1::5432 postgres:16
docker exec $name pg_isready -h 127.0.0.1 -U postgres -d $pgDb
```

Repeat `pg_isready` until it accepts connections. Use the exact published loopback port.

```powershell
try {
  $binding = docker port $name 5432/tcp
  if ($binding -notmatch '^127\.0\.0\.1:(\d+)$') { throw 'Unexpected disposable PostgreSQL port binding' }
  $port = $Matches[1]
  $base = "postgresql://postgres:$($env:POSTGRES_PASSWORD)@127.0.0.1:$port"
  foreach ($db in @($pgDb,$browserDb,$proofDb)) {
    if ($db -ne $pgDb) {
      docker exec $name createdb -U postgres $db
      if ($LASTEXITCODE -ne 0) { throw 'Disposable database creation failed' }
    }
    Get-Content -Raw database/init.sql | docker exec -i $name psql -qX -v ON_ERROR_STOP=1 -U postgres -d $db
    if ($LASTEXITCODE -ne 0) { throw 'Disposable schema initialization failed' }
  }
  $env:FRAUDLENS_PROOF_DATABASE = $proofDb
  $env:FRAUDLENS_PROOF_DATABASE_URL = "$base/$proofDb"
  node scripts/verify_neon_e2e.js
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL proof failed' }
  $env:DATABASE_URL = "$base/$pgDb"
  node security/verify-postgres.cjs
  if ($LASTEXITCODE -ne 0) { throw 'Runtime verification failed' }
  $env:DATABASE_URL = "$base/$browserDb"
  node security/verify-browser.cjs
  if ($LASTEXITCODE -ne 0) { throw 'Chrome verification failed' }
} finally {
  docker stop $name
  Remove-Item Env:DATABASE_URL,Env:POSTGRES_PASSWORD,Env:FRAUDLENS_PROOF_DATABASE,Env:FRAUDLENS_PROOF_DATABASE_URL -ErrorAction SilentlyContinue
}
```

## Owner handoff

Shivansh owns the verification harnesses and this evidence. Saumya owns the streaming pipeline, both worker entry points, and the worker fixture suite. The runtime environment now needs an explicit PostgreSQL target and internal ML token. Provision distinct secrets per environment and rotate any formerly published defaults in environments that used them. Riya and Saumya retain the inline scoring consistency issues recorded on the [Phase 2b board](phase2b-status.md#s3--credential-and-scoring-findings). Amrita retains the alert fallback status issue from the shared task board. Those findings were outside the authorization and credential checks here.
