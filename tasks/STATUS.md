# FraudLens Phase 2b status

## Integrated workspace checks, 25 November 2026 IST

This update applies to the workspace integration based on `ed73a51`. The baseline notes below record the defects that prompted the work.

| Task | Current acceptance evidence |
|---|---|
| L1, R1, R2 | Passed. The disposable PostgreSQL inline lifecycle check observed a durable pending row with null probability during ML failure, a later score after restart, and one transaction, score, alert and audit for concurrent intake and replay. Focused scorer, worker, producer and route tests passed. |
| L3 | Passed. Streaming rejects malformed and mixed-version responses. Streaming and feature tests passed. Disposable PostgreSQL verification preserved the event across an unacknowledged publication and delivered it once acknowledged. |
| L4 | Passed separately in Spark Structured Streaming and the Python fallback. Each disposable Kafka, FastAPI and PostgreSQL run preserved the first payload on replay, persisted one masked result and one audited alert, and delivered an authenticated socket event. Both used a synthetic-trained fixture. |
| A1, A2 | Implemented. Frontend lint/build and 11 Chromium fixture scenarios passed, including pending and unconfirmed transaction flows, polling recovery and VIEWER restrictions. The inline API check and Kafka fallback independently verified authenticated alert delivery. The complete Selenium run against a live inline model remains pending. |
| A3, L2 | Landing and dashboard copy reflects configured or unknown mode. A separately built inline Compose stack passed real FastAPI prediction, persisted readback, audit and authenticated WebSocket delivery with a synthetic-trained fixture. The PostgreSQL lifecycle check covered outage and restart. Full browser rehearsal against the selected release artifact remains pending. |
| S1 | Passed. The disposable inline check covered unauthenticated and disallowed writes, permitted admin and service intake, analyst review, a conflicting alert decision, and masked readback and socket data. |
| S2, S4 | Local OIDC fixtures passed. Applying the Google and LinkedIn schema on disposable PostgreSQL preserved all three seed accounts and made the schema readiness check pass. Credentialed provider acceptance remains pending. GitHub sign-in stays a separate rollout. |
| S3 | Passed. Streaming requires explicit DB and ML configuration. The verification scripts require loopback targets and operate read-only. The negative configuration fixtures and positive disposable PostgreSQL proof passed. |

Evidence entry points: [inline lifecycle](../tests/integration/inline-lifecycle.cjs), [Compose scoring smoke](../tests/integration/compose-scoring.cjs), [CI matrix](../.github/workflows/ci.yml), and [browser checks](../tests/selenium/test_fraudlens_e2e.py).

All 258 Jest tests, 11 OIDC pretests, 50 Python tests, three proof-script fixtures, and frontend lint/build passed. Compose configuration checks passed for development, CI and production syntax. Production validation still requires the real deployment environment.

## Baseline

Baseline `8aae93cc9c75435633280181f75db5ca334247b9` on `main`, checked 24 November 2026 IST. Locally recorded `origin/main` and `origin/dev` matched `HEAD`. Those references were read locally. The four dated owner plans in `tasks/` provide historical context. This board and the linked owner files track Phase 2b.

The evidence below covers the available Phase 0 checkout checks and Phase 1 direction checks against repository source. The live site, hosted settings, and real inference in both modes remain **unverified**. Runtime rehearsals use synthetic data on an approved disposable environment.

## Pipeline state

| Stage | Status | Evidence |
| --- | --- | --- |
| Ingestion and readback | Existing API behavior verified with mocked dependencies | POST validates an ADMIN or service submission and acknowledges it with `202 ACCEPTED`. The authenticated GET joins persisted data by ID, masks the account, and represents a stored unscored row as `PENDING` with a null probability. [POST](../backend/src/routes/transactions.routes.js#L218) · [GET](../backend/src/routes/transactions.routes.js#L137) · [Contract](../docs/CONTRACTS.md#L319) |
| Inline routing | Kafka bypass verified with mocks | `PIPELINE_MODE=inline` schedules one local scorer call and returns before Kafka connect/send. The scorer computes features, calls FastAPI, then writes transaction, score, and any alert to PostgreSQL. [Producer](../backend/src/kafka/producer.js#L43) · [Scorer](../backend/src/pipeline/inlineScorer.js#L146) |
| Inline inference failure | Defect reproduced with mocks | ML outage, timeout, and an empty prediction list each led to an attempted `fraud_results` write with `0.01`, `LEGITIMATE`, and `v1`. [Scorer](../backend/src/pipeline/inlineScorer.js#L166) |
| Inline retry consistency | Defect reproduced with mocks | A repeated ID kept the first `LEGITIMATE` score in the mock database while a second response attempted a high-risk alert. Real concurrent retry behavior is unverified. [Score write](../backend/src/pipeline/inlineScorer.js#L223) · [Alert write](../backend/src/pipeline/inlineScorer.js#L241) |
| Kafka/Spark path | Kafka producer verified with mocks. Worker path inspected in source | The producer publishes to `transactions-raw`. The worker subscribes, validates and scores batches, writes PostgreSQL data, and publishes newly inserted alerts for the backend consumer. An isolated parser fixture accepted a missing model version as `v1`. [Producer](../backend/src/kafka/producer.js#L60) · [Worker](../streaming/jobs/main_stream.py#L85) · [Parser](../streaming/jobs/pipeline.py#L108) · [Commit and publish](../streaming/jobs/pipeline.py#L335) · [Alert consumer](../backend/src/kafka/alertConsumer.js) |
| Frontend and hosted mode | Lint/build verified. Behavior inspected in source | The transaction screen reads lists and detail, and can display a persisted score or unscored result. The viewer alert fallback can display `Live` with no alert transport. The landing page describes Kafka/streaming and the checked-in Render blueprint selects inline. [Transaction screen](../frontend/src/pages/Transactions.jsx#L23) · [Alert fallback](../frontend/src/hooks/useAlertSocket.js#L42) · [Landing page](../frontend/src/pages/LandingPage.jsx#L5) · [Render config](../render.yaml#L56) |
| Auth and role boundaries | Targeted fixtures passed. Credentialed runs unverified | Password sessions use `fl_token`. Source has Google and LinkedIn OIDC, browser-bound state and nonce, Google S256, and local VIEWER registration. The saved provider evidence identifies disposable SQL approval and real-provider tests as pending. [Cookie](../backend/src/auth/session.js#L4) · [OIDC](../backend/src/auth/oidc.js#L3) · [Provider evidence](../security/social-oauth.md#L77) |

## Baseline task board

| Task | Owner | Priority | Status | Blocker or outstanding acceptance evidence |
| --- | --- | --- | --- | --- |
| [L1](lead.md#l1) Keep inline ML failures unscored | Lead | P0 | Unverified | Current failure cases attempt a score write. Fix and run the regression suite. |
| [R1](riya.md#r1) Accepted, pending, and scored readback | Riya | P0 | Blocked | L1 must supply a durable pending row. Targeted API cases remain. |
| [R2](riya.md#r2) Retry and alert consistency | Riya | P0 | Blocked | L1 handoff and approval for the disposable PostgreSQL check. |
| [S1](shivansh.md#s1) Role and masking checks | Shivansh | P0 | Unverified | Targeted fixtures passed. Runtime role matrix awaits an approved local run. |
| [A1](amrita.md#a1) ADMIN manual transaction flow | Amrita | P0 | Blocked | L1 and R1, followed by the approved loopback browser check. |
| [A2](amrita.md#a2) Accurate alert connection state | Amrita | P0 | Unverified | Source shows the false status. Browser acceptance is pending. |
| [L2](lead.md#l2) Local inline demo proof | Lead | P0 | Blocked | Runtime approval and L1, R1, R2, A1, and S1 acceptance. |
| [A3](amrita.md#a3) Evidence-backed visitor copy | Amrita | P1 | Blocked | L2 evidence for inline. L4 evidence for any claim that streaming was demonstrated. |
| [L3](lead.md#l3) Reject invalid streaming predictions | Lead | P1 | Unverified | Missing-version behavior reproduced. Streaming suite needs a Python environment with project dependencies. |
| [L4](lead.md#l4) Separate Kafka/Spark runtime proof | Lead | P1 | Blocked | L3 and approval to start the local full stack. |
| [S2](shivansh.md#s2) Existing social sign-in readiness | Shivansh | P1 | Blocked | Disposable OAuth SQL approval and an approved provider test application. |
| [S3](shivansh.md#s3) Explicit runtime and proof credentials | Shivansh | P1 | Unverified | Add configuration guards and verify both unset and explicitly configured runs. |
| [S4](shivansh.md#s4) GitHub sign-in proposal | Shivansh | P2 | Blocked | S2 and selection of the post-demo auth scope. |

## Offline checks

These checks describe the baseline. An exit code of `0` on a defect reproduction means the reproduction succeeded.

| Command or fixture | Exit | Result |
| --- | --- | --- |
| `git -c safe.directory=E:/FraudLens rev-parse HEAD origin/dev origin/main` | `0` | Three identical full hashes, shown above. |
| From `backend`, set `PIPELINE_MODE=kafka` and run `node_modules\.bin\jest.cmd --runInBand --no-cache --runTestsByPath src/tests/producer.test.js src/tests/transactions.test.js src/tests/protectedRoutes.test.js src/tests/alerts.test.js src/tests/oauthRoutes.test.js src/tests/oauthStore.test.js` | `0` | 70 tests passed across 6 suites. The Kafka, DB, and provider evidence here comes from fixtures. |
| `npm.cmd --prefix frontend run lint` | `0` | Oxlint passed. |
| From `frontend`, set `VITE_USE_MOCKS=false` and run `npm.cmd run build -- --outDir <fresh-temp-dir>` | `0` | Vite built the production bundle outside the working tree. |
| `git -c safe.directory=E:/FraudLens diff --check -- frontend/` | `0` | Frontend whitespace check passed. |
| PowerShell here-string piped to `node -`, loading `producer.js` in `node:vm` with mocked Kafka, scorer, and `PIPELINE_MODE=inline` | `0` | One synthetic publish called the scorer once, with zero Kafka connections and sends. |
| PowerShell here-string piped to `node -`, loading `inlineScorer.js` in `node:vm` with mocked query and ML fetch | `0` | A rejected fetch, simulated timeout, and empty prediction list all attempted a default score write. A separate replay fixture used one ID with successive probabilities of `0.20` and `0.90`. It retained the first score and attempted one alert on the second call. |
| PowerShell here-string piped to `python -B -`, extracting `_call_ml_service` with `ast` and injecting a mocked HTTP response | `0` | A response with one synthetic prediction and no `model_version` returned `v1`. |
| `python -B -m pytest -p no:cacheprovider -q streaming/tests/test_pipeline.py shared/tests/test_features_parity.py` | `1` | The available Python interpreter lacks `pytest`. The streaming and feature suites remain unverified. |

## Contract decisions

- Use the existing `PENDING` plus null probability representation for stored unscored transactions. Request owner approval before introducing a `FAILED` state or changing consumer-visible semantics. [Response contract](../docs/CONTRACTS.md#L337)
- Reconcile the documented streaming-only write ownership with the existing inline write path before changing `docs/CONTRACTS.md`. Record the proposed writer and retry rules for both modes in the task evidence and obtain owner approval for the contract edit. [Writer rules](../docs/CONTRACTS.md#L169) · [Inline writes](../backend/src/pipeline/inlineScorer.js#L200)

## Upkeep through Phase 3

1. After implementing or testing a task, update its owner file and this board in the same working tree. Add the date, baseline commit, exact command or browser procedure, exit code or observed result, and a short note on the environment and what passed or failed. Leave out credentials and real account data.
2. Mark `Done` and check the owner checkbox only once the full acceptance test passes. Use `Blocked` for an unmet prerequisite, including required environment approval, or `Unverified` for pending, partial, or failing acceptance. Keep the checkbox unchecked and record the specific reason in both places.
3. Leave the board and linked owner updates uncommitted for review.
