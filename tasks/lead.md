# Lead

AI/ML, DevOps, and big data. Owns the FastAPI inference path, pipeline modes, Kafka/Spark, deployment configuration, and integrated proof runs. Backend write behavior is coordinated with Riya.

## P0

### L1

- [x] **Keep inline transactions unscored when ML fails** · Passed the scorer and worker regressions and the disposable PostgreSQL lifecycle check on 25 November 2026.
- **Goal** — Persist an accepted synthetic transaction so it can be read as `PENDING`, with no `fraud_results` or alert until a validated ML response is available. Validate response shape, matching transaction ID, model version, numeric probability and anomaly score, boolean anomaly flag, and explanations against the prediction contract. Preserve feature history semantics when storing the pending row.
- **Files** — `backend/src/pipeline/inlineScorer.js`, `backend/src/tests/producer.test.js`, and planned `backend/src/tests/inlineScorer.test.js`.
- **Dependencies** — Agree the pending-row behavior and write handoff with Riya. Amrita [A1](amrita.md#a1) uses that API behavior. See the contract decisions on the [master board](STATUS.md#contract-decisions).
- **Acceptance** — After adding the regression cases, run `npm.cmd --prefix backend test -- --runTestsByPath src/tests/producer.test.js src/tests/inlineScorer.test.js`. Cover successful response, ML down, timeout, non-2xx, malformed response, missing prediction fields, and mismatched transaction ID. Assert a failure can leave a readable pending transaction, with no fabricated score, explanation, model version, alert row, audit alert, or broadcast. Assert the producer invokes the inline scorer once without Kafka connect/send in inline mode. Verify supported fields and values are persisted from a valid prediction.
- **Evidence** — The inline scorer initializes defaults before fetching and reaches the score insert after failures. The three in-memory fixtures exercised that path. The producer already bypasses Kafka in inline mode. [Scorer](../backend/src/pipeline/inlineScorer.js#L161) · [Prediction schema](../ml-service/app/main.py#L70) · [Producer](../backend/src/kafka/producer.js#L49) · [Baseline](STATUS.md#offline-checks)

### L2

- [ ] **Prove the local inline demo end to end** · Inline passed real FastAPI, PostgreSQL, audit and WebSocket checks in disposable Compose, plus an outage and restart fixture. Full browser rehearsal with the selected release artifact remains pending.
- **Goal** — Rehearse the minimum demonstrable inline path on a disposable local stack with real FastAPI model artifacts, local PostgreSQL, and the frontend with mocks disabled. Record the exact startup command, configured mode, and observable results.
- **Files** — `docker-compose.yml` and `render.yaml` for launch context, `docs/demo-script.md`, and `tests/selenium/test_fraudlens_e2e.py` for the local demo test. Adjust runtime config only where the local rehearsal requires it.
- **Dependencies** — Riya [R1](riya.md#r1) and [R2](riya.md#r2), Amrita [A1](amrita.md#a1), Shivansh [S1](shivansh.md#s1), and owner approval before starting containers. Run the S1 role check as an earlier step in the same approved local environment if useful.
- **Acceptance** — With `PIPELINE_MODE=inline`, correlate a synthetic authorized POST, a real ML `/predict` call, one persisted decision, and masked authenticated GET. Demonstrate high-risk alert delivery using a synthetic input whose real prediction is high risk. Repeat with ML unavailable and verify pending/null and zero alerts for that ID. Check invalid input, role denials, duplicate IDs, and browser reload. Save commands, exit codes, service and mode evidence, synthetic IDs, and row/alert counts. Run `python -m pytest -q tests/selenium/test_fraudlens_e2e.py -k manual_transaction` after the case exists.
- **Evidence** — Backend mode selection, inline inference, and the model-artifact inference path exist in source. The recorded offline tests do not include a real ML call or runtime readback. [Mode startup](../backend/src/server.js#L18) · [Inline request](../backend/src/pipeline/inlineScorer.js#L161) · [FastAPI inference](../ml-service/app/main.py#L89) · [Blueprint](../render.yaml#L56)

## P1

### L3

- [x] **Reject invalid predictions in the streaming batch** · Passed streaming regression tests and a disposable PostgreSQL check on 25 November 2026.
- **Goal** — Validate streaming ML responses against the same prediction contract before applying scores. Reject missing, duplicate, unexpected, or invalid prediction IDs and fabricated fields. Keep each persisted model version tied to its prediction, or fail a mixed-version batch before writes. Preserve the retriable failure behavior.
- **Files** — `streaming/jobs/pipeline.py` and `streaming/tests/test_pipeline.py`.
- **Dependencies** — Use the validation rules agreed in [L1](#l1). Riya reviews decision thresholds and Shivansh [S3](shivansh.md#s3) coordinates ML request configuration.
- **Acceptance** — Run `python -m pytest -q streaming/tests/test_pipeline.py` with the repository's Python dependencies. Add cases for transport failure, missing/invalid fields and predictions, mismatched IDs, mixed model versions, and a valid batch. Verify invalid batches commit no score or alert and publish no alert event. Verify a valid batch persists the exact model versions and prediction fields used.
- **Evidence** — The batch parser supplies a model version default, and classification supplies defaults for some absent prediction fields. The parser fixture accepted a successful response without a version. [Parser](../streaming/jobs/pipeline.py#L108) · [Classification](../streaming/jobs/pipeline.py#L248) · [Baseline](STATUS.md#offline-checks)

### L4

- [x] **Prove full Kafka/Spark mode separately** · Spark and the Python fallback independently passed against disposable Kafka, PostgreSQL, and a real FastAPI predictor with a synthetic-trained model on 25 November 2026.
- **Goal** — Rehearse backend-to-Kafka-to-Spark-to-ML-to-PostgreSQL and the alert consumer using a separate disposable local environment. Observe which worker actually processes the events.
- **Files** — `docker-compose.yml`, `streaming/jobs/main_stream.py` and `backend/src/kafka/alertConsumer.js` if diagnosis identifies a defect, and `docs/demo-script.md` for evidence.
- **Dependencies** — Complete [L3](#l3). Riya provides retry assertions. Shivansh supplies the approved role and masking checks. Obtain owner approval before starting containers.
- **Acceptance** — Start the approved local full stack with `PIPELINE_MODE=kafka`. Capture the startup and verification commands with exit codes. Correlate one synthetic POST to `transactions-raw`, the Spark (or observed fallback) worker, real ML inference, one stored result and masked GET. Replay the same ID and confirm no inline call or duplicate score, high-risk alert, or alert event. Record a Spark-specific pass only if Spark ran.
- **Evidence** — Compose declares Kafka initialization and streaming; Spark subscribes to `transactions-raw`; the streaming job commits PostgreSQL data and publishes newly inserted alerts on `fraud-alerts`. Existing evidence does not distinguish a running Spark worker from its fallback. [Compose](../docker-compose.yml#L56) · [Spark subscription](../streaming/jobs/main_stream.py#L85) · [Alert publish](../streaming/jobs/pipeline.py#L335)
