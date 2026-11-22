# FraudLens Phase 2 security evidence

Execution date **23 November 2026 (IST)**. Workspace `E:\Fradulense`, branch `shivansh/security-completion`, baseline `40ccb57`. All application data used for the verification below was synthetic.

## Runtime coverage

- Jest used the real Express routes, JWT verification, and authorization code. The route fixtures replace PostgreSQL and Kafka in those suites. Direct schema tests use the installed Zod 4.6.7.
- `node security/verify-postgres.cjs` used a fresh PostgreSQL 16 Docker container and a loopback backend. It exercised actual Node–PostgreSQL queries, bcrypt, expiry recovery, cookie sessions and WebSockets. Kafka/ML services were not part of this check. Alert delivery used a fixture inside the backend process.
- Python 3.11 tests used synthetic/local ML fixtures. Headless Chrome exercised the real production frontend build, a loopback backend, and a fresh PostgreSQL database. It signed in, received a masked alert over the authenticated WebSocket, checked the HttpOnly/SameSite cookie and VIEWER denial, and signed out. Full Kafka/streaming/ML deployment and HTTPS proxy checks were outside that run.
- A separate Minikube 1.38.1 profile with Kubernetes 1.35.1 and Calico validated 15 manifests with `kubectl apply --dry-run=client`. The checked-in policies also passed live ingress checks on synthetic pods. A full application rollout on the cluster remains unverified.

## Verification totals

| Check | Observed result |
|---|---|
| Backend Jest | PASS, 175 tests across 18 suites. Phase 1 baseline was 124 across 13 suites |
| Frontend build and Chrome smoke test | PASS. [VIEWER denial screenshot](security-browser.png) |
| Disposable PostgreSQL 16 | PASS. All 24 audit rows verified, including 12 concurrently written rows and one genesis |
| Python tests after upgrades | 17 passed, 1 skipped because `fraudTrain.csv` is unavailable. Two dependency deprecation warnings remain |
| Backend and frontend npm audits | PASS, zero known vulnerabilities reported |
| Python dependency audit and `pip check` | PASS after remediation, zero known vulnerabilities and no broken requirements |
| Compose configuration | PASS, published services are exactly `backend` and `frontend` |
| Kubernetes | PASS, four static tests, 15 client-dry-run resources, five allowed paths and two denied paths plus DNS on Calico fixture pods |
| Secret scanning | PASS, redacted Gitleaks scan of local Git history reported no matches |

The original Python audit found eight findings. For pytest 8.3.3 it reported `PYSEC-2026-1845`. For Starlette 0.41.3 it reported `PYSEC-2026-161`, `-249`, `-248`, `-1942`, `-1941`, `-2281` and `-2280` (all with the `PYSEC-2026` prefix). FastAPI 0.165.0 supports the patched Starlette 1.6.0, and pytest was upgraded to 9.0.3. The same strict audit passed afterward without suppressions. Hosted CI execution remains pending.

## Security cases

`PASS` below refers to the environment in the evidence column.

| ID and control | Procedure and expected result | Observed result | Evidence |
|---|---|---|---|
| C12-01 Lockout and throttling | Five incorrect passwords on an isolated account. Reject while locked and allow verified sign-in after expiry. Rate limiter returns 429 after its quota | PASS. Five concurrent requests returned 401, lock was within the 15-minute bound, and counters reset on recovery. Dedicated Jest limiter check returned 429 | PostgreSQL harness, `authRateLimit.test.js` |
| C12-02 Generic login failures | Use known and nonexistent fixture usernames with invalid credentials. Same generic 401 | PASS. Both paths use 401 `INVALID_CREDENTIALS` | `authRoutes.test.js` |
| C12-03 JWT integrity | Check existing signature-integrity fixture. Expect no authenticated user | PASS, existing unit regression. Live crafted-token exercise NOT RUN | `jwt.test.js` |
| C12-04 Algorithm restriction | Check existing unsigned-token verifier fixture. Expect no authenticated user | PASS, existing unit regression. Live crafted-token exercise NOT RUN | `jwt.test.js` |
| C12-05 Expiration | Verify an expired session fixture. Expect no authenticated user | PASS | `jwt.test.js` |
| C12-06 RBAC | Sign in as synthetic VIEWER or ANALYST and check restricted routes. Expect 403 | PASS with PostgreSQL-backed VIEWER and Jest role fixtures | PostgreSQL harness, `protectedRoutes.test.js` |
| C12-07 Authentication | Access protected endpoints without a session. Expect 401 and request ID | PASS for 17 REST operations | `protectedRoutes.test.js` |
| C12-08 Service auth | Missing or wrong credential without ADMIN session returns 401. Configured token or current ADMIN may ingest | PASS, Kafka publishing mocked. Configured service request returned 202 without API quota headers | `protectedRoutes.test.js`, `apiHardening.test.js`, `transactions.test.js` |
| C12-09 SQL data binding | Check bound query parameters and reject malformed filter types | PASS for defensive validation and binding assertions. SQL injection payload execution NOT RUN | `securityAdmin.test.js`, `securityValidation.test.js`, source review |
| C12-10 Parser and size limits | Malformed JSON and body over 100 KiB produce bounded JSON errors | PASS, 400 and 413 with request IDs | `apiHardening.test.js` |
| C12-11 Account masking | Verify masked REST and WebSocket outputs using known synthetic account values | PASS for transaction and alert routes and live local WebSocket. Protected nested transaction details omit `account_ref` | `transactions.test.js`, `alerts.test.js`, PostgreSQL harness |
| C12-12 Audit integrity | Feed the verifier inconsistent in-memory rows, then verify a live intact chain after concurrent writes | PASS, verifier rejects content/link mismatches and reports the first failing row. PostgreSQL verifier accepted 24 rows including 12 concurrent writes and one genesis | `auditIntegrity.test.js`, PostgreSQL harness |
| C12-13 WebSocket without a session | Connect without a cookie, expect close 4401. A foreign browser handshake with a fixture session should close with 4403 | PASS, 4401 and 4403. Same-origin Chrome received a masked alert | PostgreSQL and Chrome harnesses, `alertSocket.test.js` |
| C12-14 Current roles and status | Update a synthetic role and disable the account. Expect current role, REST 401 and WebSocket close before delivering the next alert | PASS | PostgreSQL harness, `authMiddleware.test.js` |
| C12-15 User management | Lower roles cannot create/update. ADMIN cannot disable or demote self. Reject unexpected fields | PASS, 403, 409 and 400 respectively | `protectedRoutes.test.js`, `securityAdmin.test.js` |

## Reproduction commands

```powershell
npm.cmd --prefix backend test -- --silent
npm.cmd --prefix backend audit --audit-level=high
npm.cmd --prefix frontend audit --audit-level=high
npm.cmd --prefix frontend run build
$env:PYTHONPATH = "$PWD/ml-service;$PWD"
python -m pytest -q -rs ml-service/tests shared/tests
python -m pip_audit --strict -r ml-service/requirements.txt
python security/verify-k8s.py -v
docker compose --env-file .env.example config --no-env-resolution --format json
docker run --rm --network none --mount "type=bind,source=$((Get-Location).Path),target=/repo,readonly" ghcr.io/gitleaks/gitleaks:v8.28.0 git /repo --redact=100 --no-banner --log-opts=--all
git diff --check 40ccb57 HEAD
git status --short --branch
```

For database initialization, exact loopback environment settings and cleanup, use [defensive verification](../../security/attack_tests/README.md). For Kubernetes dry-run and the distinction between manifest checks and deployment, see the [Minikube runbook](../../deploy/k8s/README.md).

For the Calico check, the profile was started with `--driver=docker --cni=calico --keep-context` and dedicated temporary profile/config files. The `fraudlens` namespace contained BusyBox HTTP fixtures on TCP 5432 and 8000 with the `app: postgres` and `app: ml-service` labels. The checked-in `network-policy.yaml` was applied. Fixture pods labeled `backend` and `streaming` reached both services, and `ml-service` reached the PostgreSQL fixture. From an unrelated pod, `nslookup` succeeded and `wget -O - -T 3` to each fixture timed out. Compare these outcomes only with the checked-in allow lists and working positive controls.

## Scope and caveats

- The audit hash covers the contract fields. It detects structural and stored-data mismatches within the available rows. A sufficient number of independently stored checkpoints is needed to establish whether the audit tail was removed or the entire chain was rewritten. Historical rows may use pre-canonical JSON ordering. Preserve their hashes during investigation.
- Both API quotas use Express's client IP and per-process counters. Validate trusted proxy attribution, distributed rate enforcement and the 100 TPS ingestion target when deploying. Fetch Metadata denies foreign browser writes and foreign WebSocket upgrades when the browser supplies it. SameSite and application authorization also apply. The local browser run used HTTP, and the Secure flag was verified separately in Jest.
- The base Compose config publishes frontend and backend only, but currently supplies the shared `.env` to multiple workloads. Infrastructure owners should separate runtime secrets and database privileges before production.
- The browser screenshot shows the synthetic VIEWER denial. Unit and integration outcomes are recorded as measured text.

## Final pre-PR corrections

Executed **23 November 2026 (IST)** on `shivansh/security-completion` from checkpoint `db56432`. The results below supersede Phase 2 evidence for the changed controls.

| Check and command | Result and scope |
|---|---|
| `npm.cmd --prefix backend test -- --silent --no-cache alertSocket.test.js authMiddleware.test.js authRoutes.test.js authRateLimit.test.js jwt.test.js protectedRoutes.test.js transactions.test.js models.test.js trustedProxy.test.js apiHardening.test.js` | PASS, 134 tests across 10 suites. Covers exact Origins, origin-denied HTTP 403, approved-origin authentication close 4401, RBAC, isolated proxy quotas, masked search and drift input validation. |
| `npm.cmd --prefix backend test -- --silent --no-cache` | PASS, 201 tests across 19 suites. Baseline was 175 across 18 suites. The old origin fixture expected a post-upgrade close and relied on Fetch Metadata. It now asserts an HTTP rejection before upgrade. The drift fixture now checks the upstream query string. |
| `npm.cmd --prefix frontend run build` | PASS. No frontend files changed. |
| `npm.cmd audit --audit-level=high` from `backend` and `frontend` | PASS, zero known vulnerabilities reported for either lockfile. |
| `python -m pytest -q -rs -p no:cacheprovider ml-service/tests shared/tests` with the installed Python 3.11 environment and ML/root `PYTHONPATH` | PASS, 17 passed, 1 skipped for the unavailable `fraudTrain.csv`. Two dependency deprecation warnings. |
| `python -m pip check` and `python -m pip_audit --strict -r ml-service/requirements.txt` | PASS, no broken requirements and no known vulnerabilities reported. |
| `node security/verify-postgres.cjs` using the disposable setup in the [verification README](../../security/attack_tests/README.md) | PASS. Masked account and transaction ID matched. The raw account returned zero. Invalid service token returned 401. Foreign Origin returned HTTP 403 with a valid fixture session. Lockout, RBAC, live status changes, masking and the complete 24-row audit chain passed. |
| Real Express, Uvicorn and PostgreSQL integration with four scored fixtures | PASS. `POST /api/models/drift-check` returned four by default and one with JSON `{"sample_size":1}`. The direct FastAPI query returned one. Configured streaming token, a real prediction, retrain HTTP 202, and activation HTTP 200 also passed. |
| Chrome through the actual local Vite proxy at `http://127.0.0.1:5173` | PASS. Default loopback Origin, login, logout, masked WebSocket alert and VIEWER denial worked. Vite emitted socket resets during test teardown. |
| `node security/verify-browser.cjs` with `FRAUDLENS_HTTPS_OPENSSL` and `FRAUDLENS_CHROME` set as in the [HTTPS runbook](../../deploy/nginx/README.md) | PASS with local Nginx and an ephemeral TLS certificate. Chrome validated login, Secure/HttpOnly/SameSite cookies, authenticated masked alert delivery, VIEWER denial, and logout. Nginx replaced an incoming forwarding header, and Express used the fixture's observed proxy peer. Harness startup failures were resolved by waiting for HTTPS readiness and rewriting the fixture upstream directives. Alert delivery used an in-process fixture. |
| Simulator `load_test.run_load_phase` against the local Express app at 100 TPS for 120 seconds | PASS, 12,000 HTTP 202 responses, zero failures, 99.94 TPS. The Kafka publisher was a counted fixture. This establishes the HTTP limiter exemption and leaves broker throughput unmeasured. |

### Release configuration and pending decisions

- Express trusts forwarded client IPs only when `TRUSTED_PROXY_CIDRS` lists validated peers. The proxy fixture gave nine dashboards separate quotas, kept malformed forwarding metadata on the socket quota, and returned 429 only for the exhausted client. The Nginx gateway replaces supplied forwarding addresses with its observed peer address. Saumya must confirm the actual ingress addresses and attribution of any preceding load balancer. Counters remain per-process.
- Vite and the Nginx gateway route same-origin WebSocket upgrades. Nginx needs `COOKIE_SECURE=true` and the exact public origin in `WS_ALLOWED_ORIGINS`. Docker Compose on the default loopback hostname and port uses the development allowlist. Other browser Origins, including Minikube's exposed URL, need explicit allowlisting. The current Vercel template rewrites only API traffic to Render. Its SPA fallback covers `/ws/alerts`, so that template cannot deliver the current socket architecture. Saumya must select the release ingress and verify its public TLS chain. See the [Nginx runbook](../../deploy/nginx/README.md).
- Full Kafka, Spark, ML, PostgreSQL and browser alert flow and the 50 TPS sustained run are **NOT RUN**. The local Kafka/Spark stack was unavailable. An alert injected in the Chrome fixture verifies browser delivery only.
- C12 live crafted JWT, SQL injection and persisted audit-modification cases are **NOT RUN**. The existing JWT verifier regressions, bounded search and SQL-binding assertions, and mismatch checks on in-memory audit fixtures passed. The [two-minute guide](../../security/demo-guide.md) identifies the live disposable checks and the unit-only cases.
- Riya's review is pending for the Express bootstrap, socket upgrade behavior, search SQL and drift forwarding. Saumya's review is pending for the Nginx forwarding and local certificates and the release-ingress decision. No public deployment was made.
