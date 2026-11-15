# TASKS: RIYA (Backend + Data Science)

**Branch prefix:** `riya/`  **Presentation:** Fri 27 Nov 2026
**Read first:** `docs/CONTRACTS.md` (the law), `TEAMMATE.md` (workflow)

## Starter prompt for your AI helper (paste this first)

> You are my pair-programmer on the FraudLens capstone (presentation 27 Nov 2026). Read `docs/CONTRACTS.md` and this task file completely before writing code.
> I own ONLY: `backend/src/` EXCEPT `middleware/`, `validation/`, `audit/`, `utils/jwt.js`, `routes/auth|users|audit.routes.js`, and `backend/scripts/seed.js` + `verify_audit_chain.js` (those belong to Shivansh);
> plus `shared/` (features, category map, thresholds, spec, tests), `data-science/`.
> Do not edit other folders. Never change CONTRACTS.md; if something looks wrong, stop and tell me.
> Backend is Node.js + Express (CommonJS), `pg`, `kafkajs`, `ws`. Data science is Python (pandas, scikit-learn, matplotlib).
> Keep the code simple and commented because I must explain it in a viva. Work task by task in the given order. After each task, give me the run command, a quick test, and a git commit message.

## Your two jobs
1. **Backend (non-security routes):** Express app skeleton, DB access, Kafka producer, alert consumer + WebSocket, transactions/alerts/dashboard/models routes.
2. **Data Science:** dataset, features (the shared module that both training and streaming use), thresholds, evaluation, PSI function.

The DS feature module is on the **critical path** (the lead's ML training and streaming both wait for it). Deadline: **Wed 18 Nov noon**.

---

## Backend

You import Shivansh's modules by their contract names (CONTRACTS section 9). The skeleton already contains STUBS for them, so you are never blocked. Do not edit them.

**B1. Skeleton (Mon 16 Nov, push by night).**
`backend/package.json` (express, pg, kafkajs, ws, cookie-parser, helmet, cors not needed because of the Vite proxy, dotenv), `src/server.js` (JSON body, cookie-parser, mount routers, central error handler returning the CONTRACTS error shape, `GET /health`), `src/config/db.js` (pg Pool from `DATABASE_URL`), `src/config/env.js`, `Dockerfile` (node:20-alpine, `npm ci`, `node src/server.js`), a tiny `README` for the backend folder.
Mount empty routers for Shivansh's routes so his files drop in.
Branch: `riya/backend-skeleton`.

**B2. Ingestion (Tue 17 Nov).** `POST /api/transactions`: `serviceAuth` -> `validate(schemas.createTransaction)` -> add `ingested_at = now` -> publish to Kafka `transactions-raw` with key `account_ref` -> respond **202** `{transaction_id, status:"ACCEPTED"}`. If Kafka is down, return 503 `SERVER_ERROR` (never pretend it was accepted). `src/kafka/producer.js` connects once and reuses the producer.

**B3. Read APIs (Wed 18 - Thu 19 Nov).** Parameterised SQL only (no string concatenation).
- `GET /api/transactions` (join `fraud_results`, `alerts`; filters `risk`, `from`, `to`, `q`; paging; `PENDING` for unscored; apply `maskTransaction`).
- `GET /api/transactions/:id` (adds `top_reasons`, `features`, timestamps, alert).
- `GET /api/alerts`, `PATCH /api/alerts/:id` (state machine in CONTRACTS section 8; set `resolved_by`; call `audit({action:"ALERT_STATE_CHANGED", ...})`; 409 if already RESOLVED).
- Write a seed script `backend/scripts/seed_sample_data.js` that inserts ~200 fake rows into the three tables so Amrita can work without the pipeline. **(Mon-Tue; helps her a lot.)** Note: `backend/scripts/seed.js` (users) is Shivansh's, so use a different name.

**B4. Dashboard (Fri 20 Nov).**
`GET /api/dashboard/summary` (counts, open alerts, latency percentiles from CONTRACTS section 10 using `percentile_cont`, active model + latest drift status, `system_status`) and `GET /api/dashboard/trends?minutes=60` (per-minute `total` and `flagged`, use `date_trunc('minute', ...)` joined to `fraud_results`).
System status: backend UP (you are answering), database UP (a `SELECT 1`), kafka UP (producer connected), ml_service UP (`GET {ML_SERVICE_URL}/health`, 1 s timeout), streaming UP (`service_heartbeats` within 60 s).

**B5. Alert consumer + WebSocket (Thu 19 - Fri 20 Nov).**
`src/kafka/alertConsumer.js`: consumer group `backend-alerts` on `fraud-alerts`; for each message call `audit({action:"ALERT_RAISED", ...})` and broadcast `{"type":"NEW_ALERT","alert":<message>}` to all WebSocket clients. `src/websocket/alertSocket.js`: `ws` server on path `/ws/alerts` attached to the HTTP server; on connection call `verifyRequestCookie(req)` (Shivansh's util) and close with code 4401 if it returns null. Ping every 30 s.

**B6. Models proxy (Sat 21 Nov).** `routes/models.routes.js`: ADMIN-only routes from CONTRACTS section 8, forwarding to `ML_SERVICE_URL` with `X-Internal-Token`; call `audit` with `MODEL_DRIFT_CHECK`, `MODEL_RETRAIN`, `MODEL_ACTIVATED`. Timeouts 30 s for retrain.

**B7. Tests (Sun 22 - Mon 23 Nov).** Jest + supertest for ingestion (202, 400), alerts state machine (200, 409), masking (no `account_ref` in any response).

---

## Data Science

**D1. Dataset and loader (Mon 16 Nov).** Download Kaggle "Credit Card Transactions Fraud Detection Dataset" (Sparkov-generated), put `fraudTrain.csv` and `fraudTest.csv` in `data-science/datasets/` (git-ignored). Write `data-science/load_data.py` mapping CSV columns to the names in CONTRACTS section 5. **Check the real column names and the date ranges**, and report any mismatch to the lead by Tue noon so CONTRACTS can be corrected.

**D2. EDA (Mon 16 - Tue 17 Nov).** `notebooks/01_eda.ipynb`: fraud rate (expected well under 1%), fraud by category and hour, amount distributions, transactions per card, train/test date ranges. Save 4-5 clean charts for the report.

**D3. Feature module, CRITICAL (due Wed 18 Nov noon).**
- `shared/fraud_features.py` with `build_features(df)` exactly per CONTRACTS section 5 (13 features). Vectorised pandas; time-window counts via `groupby(account_ref).rolling("3600s", on="tx_time", closed="left")` or an equivalent approach; the first transaction of an account uses the defaults in the table.
- `shared/category_map.json`: sorted category names -> integers from the training data; unknown = -1.
- `shared/feature_spec.md`: one page describing each feature in plain English (this goes into the report).
- `shared/tests/test_features_parity.py`: take 200 random accounts, compute features with the full history and with only the 50 most recent prior rows per transaction batch, assert they are equal for the 13 features. This test proves that training and live scoring agree.
Merge to `dev` as soon as the parity test passes, then tell the lead.

**D4. Thresholds (Thu 19 - Fri 20 Nov).** `notebooks/03_thresholds.ipynb`: once the lead has a v1 model (or use a quick XGBoost baseline until then), choose `high` and `low` in `shared/thresholds.json` so HIGH_RISK is about 1-2% of test transactions. Show the precision/recall trade-off chart and justify the choice in two sentences.

**D5. Evaluation (Sat 21 - Mon 23 Nov).** `notebooks/04_evaluation.ipynb` + `docs/test-reports/model-evaluation.md`: PR-AUC, ROC-AUC (secondary), precision/recall/F1 at the chosen thresholds, confusion matrix, top feature importances, and one paragraph comparing XGBoost alone vs. XGBoost + Isolation Forest hybrid. **Do not report accuracy as the headline** (it is meaningless at 0.5% fraud).

**D6. PSI (Sun 22 Nov).** `data-science/drift/psi.py`: `psi(expected_proportions, actual_proportions)` and `bin_and_psi(reference_edges, reference_props, new_values)` with epsilon smoothing to avoid log(0), plus unit tests (identical data -> about 0; shifted data -> large). The lead's `/drift/check` calls it.

**D7. Report material (Tue 24 - Wed 25 Nov).** Sections for the final report: dataset description, features, thresholds, evaluation, limitations (synthetic data, single dataset, no real bank integration).

---

## Order of days
Mon 16: B1 + D1. Tue 17: B2 + D2 + start D3. Wed 18 noon: **D3 merged**. Wed-Thu: B3, B5. Fri: B4, D4. Sat: B6. Sun-Mon: B7, D5, D6. Tue-Wed: D7, support the demo.

## Acceptance checklist
- [ ] Backend runs in Docker; `/health` works; 202 ingestion path publishes to Kafka
- [ ] No API response ever contains `account_ref`
- [ ] Alert PATCH enforces the state machine and writes an audit event
- [ ] WebSocket pushes new alerts only to authenticated clients
- [ ] `fraud_features.py` parity test passes; thresholds file justified; evaluation report with PR-AUC
- [ ] PR checklist from `TEAMMATE.md` completed for every PR
