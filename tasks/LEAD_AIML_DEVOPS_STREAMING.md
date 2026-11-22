# TASKS: TEAM LEAD (AI/ML + DevOps + Big Data/Streaming)

**Branch prefix:** `lead/`  **Presentation:** Fri 27 Nov 2026
**Read first:** `docs/CONTRACTS.md` (the law), `TEAMMATE.md` (workflow)

---

## CURRENT STATUS & WHAT IS LEFT FOR FINAL SUBMISSION (Updated 22 Nov 2026)

### Already Completed by Team Lead (Merged on `main` & `dev`)
- **Phase 0 (`T0.1–T0.4`)**: Repo scaffold, `database/init.sql`, `docker-compose.yml` (Postgres 16, Kafka KRaft, `kafka-init`, `ml-service`, `streaming`, `backend`, `frontend`), FastAPI `ml-service` with constant-time `X-Internal-Token` security.
- **Phase 1 (`T1.1–T1.3`)**: `streaming/jobs/pipeline.py` (validation, DLQ, 50-row lookback feature engineering via `shared/fraud_features.py`, chunked `/predict` with 3x retry, threshold classification, idempotent writes, `fraud-alerts` publisher, heartbeats), `streaming/jobs/main_stream.py` (PySpark Structured Streaming + `consumer_fallback.py`), `simulator/replay.py`.
- **Phase 2 (`T2.1–T2.4`)**: `ml-service/training/train.py` (time-ordered XGBoost + Isolation Forest hybrid training, `reference_stats.json`, deterministic folder SHA-256), `ml-service/app/predictor.py` (SHA-256 verification before load, `pred_contribs` top-3 human-readable explanations).
- **Phase 3 (`T3.1–T3.4`)**: `POST /drift/check` (`ml-service/app/drift/checker.py` calling `data-science/drift/psi.py`), `POST /retrain` (`ml-service/app/retrain/service.py`), hot-reload `POST /models/{version}/activate`, `simulator/latency_report.py` -> `docs/test-reports/latency.md`.
- **Data Science Support (`D2, D4–D7`)**: `data-science/drift/psi.py`, `data-science/evaluation/evaluate_model.py`, `shared/thresholds.json`, notebooks `01_eda.ipynb`..`04_evaluation.ipynb`, `docs/test-reports/model-evaluation.md`.
- **Phase 4 & Full Capstone Rubric Deliverables**:
  - `simulator/load_test.py` (50 TPS sustained / 100 TPS burst) & `docs/demo-script.md`.
  - **Git/GitHub & Jenkins**: `.github/workflows/ci.yml` & `deploy/Jenkinsfile` (pre-flight gatekeeper on offset ports `6173`/`6000`).
  - **Docker & Kubernetes**: `docker-compose.yml` + `deploy/k8s/*.yaml` (Deployments, Services, Secrets template, Zero-Trust `NetworkPolicy`).
  - **Nginx & HTTPS**: `deploy/nginx/nginx.conf` (TLS 1.2/1.3 termination, SPA routing, `/api` proxy, `/ws/alerts` WebSocket upgrade) + `deploy/nginx/generate-certs.sh`.
  - **Swagger & Postman**: `docs/swagger/openapi.json` + interactive Swagger UI (`docs/swagger/index.html`) & `docs/postman/FraudLens.postman_collection.json` + `FraudLens.postman_environment.json`.
  - **WebHooks**: `deploy/webhooks/webhook_receiver.py` (HMAC-SHA256 signed alert webhook receiver) + Ngrok webhook config (`deploy/ngrok.yml`).
  - **Selenium E2E Testing**: `tests/selenium/test_fraudlens_e2e.py`.
  - **Cloud Deployment & JIRA**: `render.yaml`, `deploy/vercel.json`, `deploy/CLOUD_DEPLOYMENT.md`, `docs/jira/JIRA_SPRINT_BACKLOG.md`, and `docs/jira/jira_backlog_import.csv`.

### What Is LEFT for Team Lead Before Fri 27 Nov Presentation
1. **Merge Teammates' Remaining PRs into `dev` -> `main`**:
   - Merge Riya's `origin/riya/backend-ingestion` (`B2–B7`).
   - Merge Shivansh's `origin/shivansh/auth` (`C1–C2`) and upcoming `C3–C12` security commits.
   - Merge Amrita's `origin/dev` (`F1–F3`) and upcoming `F4–F8` UI screens.
2. **T4.1 Live Full-Stack Load Test & T4.5 Backup Demo Video (Wed 25 – Thu 26 Nov)**:
   - Run `python simulator/load_test.py --tps 50 --duration 300` and `--tps 100 --duration 120` against the integrated Docker stack to update `docs/test-reports/latency.md` with live full-stack numbers.
   - Rehearse `docs/demo-script.md` twice, record the backup demo video (`T4.5`), and tag `main` as `demo-ready`.

---

## Starter prompt for your AI helper (paste this first)

> You are my pair-programmer on the FraudLens capstone (presentation 27 Nov 2026). Read `docs/CONTRACTS.md` and this task file completely before writing code.
> I own ONLY: `ml-service/`, `streaming/`, `database/`, `simulator/`, `deploy/`, `.github/`, `docker-compose.yml`, `docs/demo-script.md`, `docs/test-reports/` (latency).
> Do not edit other folders. Never change CONTRACTS.md; if something looks wrong, stop and tell me.
> Keep the code simple and commented because I must explain it in a viva. Work task by task in the given order. After each task, give me the run command, a quick test, and a git commit message.

## Your folders
`ml-service/`, `streaming/`, `database/`, `simulator/`, `deploy/`, `.github/workflows/`, `docker-compose.yml`, `docs/demo-script.md`.
You consume: `shared/fraud_features.py`, `shared/thresholds.json` (Riya), backend API (Riya/Shivansh), middleware specs (Shivansh).

## Workload warning
You carry three roles. Items marked **[OFFLOAD]** can be given to a teammate who finishes early (Amrita after Fri 20 Nov for the simulator; Shivansh for CI/security scans).

---

## PHASE 0: Skeleton (Sun 15 - Mon 16 Nov)  -> M0

**T0.1 Repo setup.** Run the commands in `TEAMMATE.md` section 10 (scaffold, push `main`, create `dev`, add collaborators, protect `main`).

**T0.2 `database/init.sql`.** Copy the schema from CONTRACTS section 3 exactly.

**T0.3 `docker-compose.yml`** (build context = repo root so containers can copy `shared/`):
- `postgres:16` with `database/init.sql` mounted at `/docker-entrypoint-initdb.d/`, volume `pgdata`, healthcheck `pg_isready`.
- `kafka`: use the official **`apache/kafka`** image in KRaft mode (no Zookeeper). Single broker, advertised listener `kafka:9092` for containers and an extra host listener (for example 29092) for debugging. Verify the image tag; older tutorials using Bitnami images may fail because those images were reorganised.
- `kafka-init`: one-shot container that creates topics `transactions-raw` (3 partitions), `transactions-dlq` (1), `fraud-alerts` (1).
- `ml-service`, `backend`, `frontend`, `streaming`: each builds from its own folder's Dockerfile, `env_file: .env`, `depends_on` with healthchecks, all on one network. Only `frontend` (5173) and `backend` (5000) publish ports to the host.
- Volume for `ml-service/model_store`.

**T0.4 ML service STUB (`ml-service/app/main.py`)**: FastAPI with `/health` and `/predict` returning the exact JSON shape in CONTRACTS section 6 with fake values (for example probability = `min(0.99, amount/5000)`, one fake reason). Check `X-Internal-Token`. Dockerfile + `requirements.txt`. **Push by Mon night** so everyone can integrate.

**Done when:** `docker compose up` starts postgres, kafka (+topics), ml-service stub; backend/frontend containers start once teammates push their skeletons.

---

## PHASE 1: Walking skeleton (Tue 17 - Wed 18 Nov) -> M1

**T1.1 Pipeline core, independent of Spark.** `streaming/jobs/pipeline.py` with one function:
`process_batch(pdf, batch_id)` where `pdf` is a pandas DataFrame of parsed transactions. Steps:
1. Validate rows (required fields, `amount >= 0`, parseable time). Invalid rows -> publish to `transactions-dlq`.
2. `INSERT INTO transactions ... ON CONFLICT (transaction_id) DO NOTHING`.
3. For each account in the batch, fetch its latest 50 rows from `transactions` (excluding batch rows), concat, sort by `tx_time`, run `fraud_features.build_features`, keep only batch rows.
4. POST chunks of up to 200 rows to `ml-service /predict` with header `X-Internal-Token`; retry 3 times with backoff; if it still fails, **raise** (batch is not committed and will be retried).
5. Classify with `shared/thresholds.json` (CONTRACTS section 7).
6. Insert `fraud_results` (`ON CONFLICT DO NOTHING`, store `features` JSON and `top_reasons`).
7. For HIGH_RISK rows: insert into `alerts ... ON CONFLICT (transaction_id) DO NOTHING RETURNING alert_id`; **only if a row was inserted**, publish to `fraud-alerts`.
8. Upsert `service_heartbeats('streaming', now())`.
Use `psycopg2` or `psycopg` with one connection per batch; Kafka producer via `confluent-kafka` (or `kafka-python`).
Until Riya's `fraud_features.py` is merged (due Wed 18 noon), use a tiny local stand-in that fills the 13 features crudely, **clearly marked TEMP**.

**T1.2 Spark wrapper.** `streaming/jobs/main_stream.py`: PySpark Structured Streaming, `local[2]` mode, reads `transactions-raw` (JSON, schema from CONTRACTS section 4), `foreachBatch(lambda df, id: process_batch(df.toPandas(), id))`, trigger every 1 second, checkpoint dir in a volume. Use the Kafka connector package matching your Spark and Scala versions (for example `org.apache.spark:spark-sql-kafka-0-10_2.12:<spark-version>`); mismatched versions are the #1 failure.

**T1.3 Simulator v0** `simulator/replay.py` **[OFFLOAD]**: reads `fraudTest.csv`, maps columns per CONTRACTS section 5, sorts by time, posts to `POST /api/transactions` with `X-Service-Token` at `--tps N`. Options: `--limit`, `--seed`, `--fraud-boost 0.05` (oversample fraud rows so the demo shows alerts), `--drift-mode` (multiply amounts by 3 to trigger drift in the demo), `--url`.

**M1 test (Wed 18):** run the simulator at 5 TPS; rows appear in `transactions`, `fraud_results`, alerts appear, and Amrita's dashboard shows a toast. Stubs everywhere is fine.

**Spark go/no-go (Thu 19 Nov, noon).** If the Spark job is not consuming and writing end to end by then, switch to `streaming/jobs/consumer_fallback.py` (plain Python Kafka consumer calling the same `process_batch`). This works because `process_batch` has no Spark dependency. The SRS names Spark, so tell your mentor honestly in the presentation if you use the fallback.

---

## PHASE 2: Real ML (Wed 18 - Sat 21 Nov) -> M2

**T2.1 Training script** `ml-service/training/train.py`:
- Load `fraudTrain.csv`, build features with `shared/fraud_features.py`, **train on fraudTrain, evaluate on fraudTest** (the files are time-ordered; check the date ranges). Never random-split.
- XGBoost with `scale_pos_weight = negatives/positives`. Report PR-AUC, recall at the chosen precision, confusion matrix at thresholds.
- Save to `model_store/v1/`: `xgb_model.json` (native format), `meta.json` (feature order, category map version), `reference_stats.json` (bin edges + proportions of each feature and of the score on the training data, for PSI).
- Compute SHA-256 of the artifact folder; insert into `model_versions` with status `ACTIVE`.

**T2.2 Real `/predict`.** Load the active model at startup (verify SHA-256, refuse to load on mismatch). Return `fraud_probability` and `top_reasons` from `booster.predict(DMatrix, pred_contribs=True)`: take the 3 largest positive contributions and map each feature to a text template, for example `amount_ratio -> "Amount is {x:.0f}x this account's usual average"`.

**T2.3 Isolation Forest (FR-07).** Train on the same features (mostly legitimate rows), contamination about 0.01. Return `anomaly_score` (normalised 0-1) and `is_anomaly` in `/predict`. Save as `iforest.joblib` (loaded only after the SHA-256 check; document that pickled files are an accepted, mitigated risk).

**T2.4 Internal token check** in `ml-service/app/security.py`: constant-time compare against `INTERNAL_ML_TOKEN`. Ask Shivansh to review it.

---

## PHASE 3: Model lifecycle (Sun 22 - Mon 23 Nov) -> M3 (FEATURE FREEZE Mon night)

**T3.1 `POST /drift/check`**: take the last 1000 `fraud_results`, compute PSI of `fraud_probability` and each feature against `reference_stats.json` using Riya's `data-science/drift/psi.py`; status OK < 0.1, WARNING 0.1-0.25, DRIFT > 0.25; insert into `drift_reports`.

**T3.2 `POST /retrain`**: retrain a candidate (new version number, optionally including alert-resolved labels from `alerts.resolution` plus the training CSV), evaluate on the holdout, status `VALIDATED` if PR-AUC >= 0.95 x active PR-AUC, else `REJECTED`. Keep it synchronous or a simple background task; return the status.

**T3.3 `POST /models/{version}/activate`**: only for VALIDATED (or rollback to RETIRED); hot-reload the model without restarting; previous version becomes RETIRED. `/predict` returns the new `model_version`, so you can show it in the demo.

**T3.4 Latency report script** `simulator/latency_report.py` **[OFFLOAD]**: from the DB compute scoring p50/p95 and alert p95 (CONTRACTS section 10) and write `docs/test-reports/latency.md`.

---

## PHASE 4: Proof and polish (Tue 24 - Thu 26 Nov)

**T4.1 Load tests.** 50 TPS for as long as you can (5-10 min) and 100 TPS for 2 min. Record p95 latencies and any failures honestly in `docs/test-reports/latency.md`. If a target is missed, report the real number and the likely reason (that is acceptable; invented numbers are not).

**T4.2 CI** `.github/workflows/ci.yml` **[OFFLOAD to Shivansh for the security step]**: on push/PR: backend `npm ci && npm test`, frontend `npm ci && npm run build`, ml-service `pytest`, `docker compose build`. Keep it simple.

**T4.3 Minikube `[OFFLOADED TO SHIVANSH]`**: `deploy/k8s/*.yaml` that run the same images (Deployment + Service per component, Kubernetes Secrets example, and NetworkPolicy for internal service isolation). Handled by Shivansh in `tasks/SHIVANSH_CYBER.md` (C14). If not tested live on Minikube, present it as "manifests prepared", not as "deployed".

**T4.4 `docs/demo-script.md`** (5-7 minute scripted demo, see below) and a one-page "how to run" in `README.md`.

**T4.5 Backup video:** screen-record one full successful demo on Wed/Thu. If the live demo fails on the day, play the video.

### Demo flow to script
1. `docker compose up` already running; show the status bar all green.
2. Login as ANALYST; show masked accounts and role-based menu (log in as VIEWER to show restricted view, optional).
3. Start `replay.py --tps 10 --fraud-boost 0.05`; show counters moving and a **toast** on a HIGH_RISK alert.
4. Open the alert: score, anomaly flag, **top 3 reasons**, model version.
5. Resolve the alert as CONFIRMED_FRAUD; show it appear in the audit log (ADMIN).
6. Run `replay.py --drift-mode`; ADMIN clicks Drift check -> WARNING/DRIFT; Retrain -> VALIDATED; Activate -> new model version visible on new decisions.
7. Show the latency report and the security test report (Shivansh), then the architecture slide.

---

## Acceptance checklist
- [ ] `docker compose up` brings the whole stack up from a clean clone using `.env.example`
- [ ] Simulator -> alert on dashboard works end to end, idempotent on replay (no duplicate rows)
- [ ] XGBoost + Isolation Forest hybrid decisions with top-3 reasons
- [ ] Drift check, retrain, activate work and are audit-logged (via backend)
- [ ] Latency report with real numbers; load test results recorded
- [ ] Demo script rehearsed twice; backup video recorded; `main` tagged `demo-ready` on Thu 26 Nov

