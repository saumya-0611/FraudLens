# FraudLens: CONTRACTS (single source of truth)

> Everyone (and every AI helper) builds against THIS file. If something here is wrong or missing,
> **do not change it yourself**: message the team lead. The lead edits this file on `dev`, then everyone merges `dev`.
> Presentation: **Fri 27 Nov 2026**. SRS/SDD v1.1 remain the requirement documents (FR-01..FR-17).

---

## 1. Services, ports, environment

| Service | Tech | Port | Exposed to user? | Owner |
|---|---|---|---|---|
| frontend | React + Vite + Tailwind | 5173 | yes | Amrita |
| backend | Node + Express | 5000 | yes | Riya + Shivansh |
| ml-service | Python FastAPI | 8000 | **no** (internal) | Lead |
| streaming | Spark (PySpark) job | none | no | Lead |
| kafka | single broker, KRaft | 9092 | no | Lead |
| postgres | PostgreSQL 16 | 5432 | no (dev: may map to host) | Lead |

Frontend never calls the backend by full URL. It calls relative paths (`/api/...`, `/ws/alerts`) and the **Vite dev proxy**
forwards them to `http://backend:5000` (docker) or `http://localhost:5000` (no docker). Result: same origin, no CORS problems, cookies just work.

`.env.example` (copy to `.env`, never commit `.env`):

```
POSTGRES_USER=fraudlens
POSTGRES_PASSWORD=change_me
POSTGRES_DB=fraudlens
DATABASE_URL=postgresql://fraudlens:change_me@postgres:5432/fraudlens
KAFKA_BROKERS=kafka:9092
ML_SERVICE_URL=http://ml-service:8000
JWT_SECRET=change_me_long_random
JWT_EXPIRES_IN=2h
COOKIE_SECURE=false
SERVICE_TOKEN=change_me_service_token        # simulator -> POST /api/transactions
INTERNAL_ML_TOKEN=change_me_internal_token   # backend/spark -> ml-service
SEED_ADMIN_PASSWORD=change_me
SEED_ANALYST_PASSWORD=change_me
SEED_VIEWER_PASSWORD=change_me
VITE_PROXY_TARGET=http://backend:5000
```

---

## 2. Roles and permissions

Roles (exact strings): `ADMIN`, `ANALYST`, `VIEWER`.

| Capability | ADMIN | ANALYST | VIEWER |
|---|---|---|---|
| Dashboard, transactions (read) | yes | yes | yes |
| Alerts (read, change state, resolve) | yes | yes | no |
| Users, audit logs | yes | no | no |
| Models: view | yes | no | no |
| Models: drift check, retrain, activate | yes | no | no |
| Ingest transactions (`POST /api/transactions`) | yes (or service token) | no | no |

Accounts are created by an ADMIN (no public registration). Seed users are created by `npm run seed` in `backend/` using the `SEED_*` env vars.

**Masking rule:** `account_ref` (the full card/account id) is NEVER returned by any API. APIs return `account_masked` = `"XXXX-" + last 4 characters`. Applies to all roles, including ADMIN.

---

## 3. Database schema (PostgreSQL), final

Lead copies this into `database/init.sql`. Nobody else edits it.

```sql
CREATE TABLE users (
  id               SERIAL PRIMARY KEY,
  username         VARCHAR(50) UNIQUE NOT NULL,
  password_hash    TEXT NOT NULL,
  role             VARCHAR(10) NOT NULL CHECK (role IN ('ADMIN','ANALYST','VIEWER')),
  status           VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  failed_attempts  INT NOT NULL DEFAULT 0,
  locked_until     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Streaming writes these rows in Kafka mode. The backend writes them in inline mode.
CREATE TABLE transactions (
  transaction_id   VARCHAR(64) PRIMARY KEY,
  account_ref      VARCHAR(64) NOT NULL,
  amount           NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
  tx_time          TIMESTAMPTZ NOT NULL,
  category         VARCHAR(50) NOT NULL,
  merchant         VARCHAR(120),
  lat              DOUBLE PRECISION,
  lon              DOUBLE PRECISION,
  merch_lat        DOUBLE PRECISION,
  merch_lon        DOUBLE PRECISION,
  customer_age     SMALLINT,
  ingested_at      TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_tx_account_time ON transactions (account_ref, tx_time);
CREATE INDEX idx_tx_time ON transactions (tx_time DESC);

CREATE TABLE fraud_results (
  transaction_id    VARCHAR(64) PRIMARY KEY REFERENCES transactions(transaction_id),
  fraud_probability REAL NOT NULL,
  anomaly_score     REAL,
  is_anomaly        BOOLEAN NOT NULL DEFAULT false,
  risk_category     VARCHAR(12) NOT NULL CHECK (risk_category IN ('LEGITIMATE','SUSPICIOUS','HIGH_RISK')),
  top_reasons       JSONB NOT NULL DEFAULT '[]',
  features          JSONB NOT NULL DEFAULT '{}',   -- the 13 feature values (needed for drift checks)
  model_version     VARCHAR(30) NOT NULL,
  scored_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_fr_category ON fraud_results (risk_category);
CREATE INDEX idx_fr_scored ON fraud_results (scored_at DESC);

CREATE TABLE alerts (
  alert_id        SERIAL PRIMARY KEY,
  transaction_id  VARCHAR(64) UNIQUE NOT NULL REFERENCES transactions(transaction_id),
  risk_score      REAL NOT NULL,
  state           VARCHAR(15) NOT NULL DEFAULT 'NEW' CHECK (state IN ('NEW','UNDER_REVIEW','RESOLVED')),
  resolution      VARCHAR(15) CHECK (resolution IN ('CONFIRMED_FRAUD','FALSE_POSITIVE')),
  resolved_by     INT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (state <> 'RESOLVED' OR resolution IS NOT NULL)
);
CREATE INDEX idx_alerts_state ON alerts (state, created_at DESC);

-- Written ONLY by backend (single writer, hash chain).
CREATE TABLE audit_logs (
  id          BIGSERIAL PRIMARY KEY,
  event_time  TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id     INT,
  username    VARCHAR(50),
  action      VARCHAR(40) NOT NULL,
  entity      VARCHAR(40),
  entity_id   VARCHAR(64),
  details     JSONB NOT NULL DEFAULT '{}',
  ip          TEXT,
  prev_hash   CHAR(64) NOT NULL,
  entry_hash  CHAR(64) NOT NULL
);
CREATE INDEX idx_audit_time ON audit_logs (event_time DESC);

CREATE TABLE model_versions (
  version        VARCHAR(30) PRIMARY KEY,           -- e.g. 'v1', 'v2'
  algorithm      VARCHAR(60) NOT NULL,              -- e.g. 'xgboost+isolation_forest'
  metrics        JSONB NOT NULL DEFAULT '{}',
  status         VARCHAR(12) NOT NULL CHECK (status IN ('CANDIDATE','VALIDATED','REJECTED','ACTIVE','RETIRED')),
  artifact_path  TEXT NOT NULL,
  sha256         CHAR(64) NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at   TIMESTAMPTZ
);

CREATE TABLE drift_reports (
  id             SERIAL PRIMARY KEY,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  model_version  VARCHAR(30) NOT NULL,
  psi_score      REAL NOT NULL,                     -- PSI of fraud_probability
  psi_features   JSONB NOT NULL DEFAULT '{}',       -- PSI per feature
  status         VARCHAR(8) NOT NULL CHECK (status IN ('OK','WARNING','DRIFT')),  -- <0.1 OK, 0.1-0.25 WARNING, >0.25 DRIFT
  sample_size    INT NOT NULL
);

CREATE TABLE service_heartbeats (
  service    VARCHAR(30) PRIMARY KEY,               -- 'streaming'
  last_seen  TIMESTAMPTZ NOT NULL
);
```

Audit hash chain: `entry_hash = SHA256(prev_hash + event_time_iso + username + action + entity + entity_id + JSON(details))`.
First row uses `prev_hash = 64 zeros`. Insert inside a transaction holding `pg_advisory_xact_lock(42)` so the chain never forks.

**Kafka mode.** The backend publishes ingestion to Kafka. The worker owns transaction, score, alert creation, and its service heartbeat. The worker commits the score and any alert with an `alert_outbox` row. It deletes the outbox entry after Kafka acknowledges publication. Delivery can repeat after an interrupted acknowledgment. The backend deduplicates the alert audit by alert ID.

**Inline mode.** The backend stores the intake and an `inline_scoring_jobs` row before acknowledgment. Workers claim due jobs with expiring leases and retry failed attempts with backoff. The accepted payload stays authoritative on replay. The backend commits the score, any alert, and its audit entry in a single transaction.

**Both modes.** The backend owns users, audit logs, and alert state changes. The ML service owns model versions and drift reports. Exactly one score can be committed per transaction ID. The first accepted payload supplies the scoring features. For history, select up to 50 prior events for the same account in descending event time and transaction ID order, using ascending ID as the tie-break within a timestamp.

---

## 4. Kafka topics and message formats

| Topic | Partitions | Key | Producer | Consumer |
|---|---|---|---|---|
| `transactions-raw` | 3 | `account_ref` (keeps one account in order) | backend | streaming |
| `transactions-dlq` | 1 | none | backend or streaming | nobody (inspection only) |
| `fraud-alerts` | 1 | `transaction_id` | streaming | backend |

`transactions-raw` value (JSON, all times ISO-8601 UTC):

```json
{
  "transaction_id": "9f1c2e7a-...-uuid",
  "account_ref": "2703186189652095",
  "amount": 1850.00,
  "tx_time": "2026-11-20T03:12:45Z",
  "category": "shopping_net",
  "merchant": "fraud_Kutch LLC",
  "lat": 36.0788, "lon": -81.1781,
  "merch_lat": 36.011293, "merch_lon": -82.048315,
  "customer_age": 34,
  "ingested_at": "2026-11-20T03:12:45.412Z"
}
```

`transactions-dlq` value: `{"raw": "<original string>", "error": "amount missing", "source": "backend|streaming", "failed_at": "ISO"}`

`fraud-alerts` value (no full account number):

```json
{
  "alert_id": 17,
  "transaction_id": "9f1c2e7a-...",
  "account_masked": "XXXX-2095",
  "amount": 1850.00,
  "category": "shopping_net",
  "risk_score": 0.93,
  "risk_category": "HIGH_RISK",
  "top_reasons": [{"feature":"amount_ratio","text":"Amount is 38x this account's usual average","impact":0.41}],
  "model_version": "v1",
  "created_at": "2026-11-20T03:12:46.900Z"
}
```

---

## 5. Features (13), final contract between DS, ML, and streaming

One shared Python module `shared/fraud_features.py` (owner: Riya) is imported by BOTH model training and the streaming job.
This prevents training/serving skew. Function: `build_features(df) -> df` where `df` has the transaction columns (§4 names), plus any prior history rows.

| # | Feature | Definition |
|---|---|---|
| 1 | `amount` | transaction amount |
| 2 | `log_amount` | `log1p(amount)` |
| 3 | `hour` | hour of `tx_time` (0-23, UTC) |
| 4 | `day_of_week` | 0=Mon .. 6=Sun |
| 5 | `is_night` | 1 if hour < 6 or hour >= 22 else 0 |
| 6 | `category_code` | integer from `shared/category_map.json` (unknown = -1) |
| 7 | `distance_km` | haversine((lat,lon),(merch_lat,merch_lon)) |
| 8 | `customer_age` | years |
| 9 | `tx_count_1h` | number of PRIOR transactions of the same `account_ref` in the 60 min before `tx_time` (self excluded) |
| 10 | `tx_count_24h` | same, 24 hours |
| 11 | `secs_since_last_tx` | seconds since the account's previous transaction (none -> 604800) |
| 12 | `avg_amount_prior` | mean `amount` of the account's last up-to-30 prior transactions (none -> own `amount`) |
| 13 | `amount_ratio` | `amount / max(avg_amount_prior, 1)` |

History rule for streaming: for each account in the batch, fetch the 50 most recent rows from `transactions`, concatenate with the batch,
sort by `tx_time`, call `build_features`, keep only the batch rows. **Parity test required:** features computed with full history must equal
features computed with the truncated 50-row history on a sample (Riya writes `shared/tests/test_features_parity.py`).

Dataset: Kaggle "Credit Card Transactions Fraud Detection Dataset" (Sparkov-generated), files `fraudTrain.csv` (train) and `fraudTest.csv` (test),
stored in `data-science/datasets/` (git-ignored). Mapping from CSV to our names is the first job of Riya's loader: verify actual column names yourself.
`cc_num -> account_ref`, `amt -> amount`, `trans_date_trans_time -> tx_time`, `trans_num -> transaction_id`, `long -> lon`, `merch_long -> merch_lon`,
`dob -> customer_age`, `is_fraud` = label (used only for training/evaluation, never sent through the pipeline).

---

## 6. ML service API (FastAPI, internal only)

Inference and model operations require `X-Internal-Token: <INTERNAL_ML_TOKEN>` (else 401). The root metadata route and health probes are public. Readiness verifies the supplied token when called by the backend.

`POST /predict`

```json
// request
{ "instances": [ { "transaction_id": "t1", "features": { "amount": 1850.0, "log_amount": 7.52, "hour": 3, "day_of_week": 4, "is_night": 1,
  "category_code": 8, "distance_km": 41.2, "customer_age": 34, "tx_count_1h": 3, "tx_count_24h": 5,
  "secs_since_last_tx": 40, "avg_amount_prior": 48.3, "amount_ratio": 38.3 } } ] }
// response
{ "model_version": "v1",
  "predictions": [ { "transaction_id": "t1", "fraud_probability": 0.93, "anomaly_score": 0.71, "is_anomaly": true,
    "top_reasons": [ { "feature": "amount_ratio", "impact": 0.41, "text": "Amount is 38x this account's usual average" } ] } ] }
```

`top_reasons` = top 3 positive contributions from XGBoost `pred_contribs`, with human-readable text (template per feature, written by Lead).

| Method | Path | Purpose |
|---|---|---|
| GET, HEAD | `/health` | Liveness, including the current predictor version |
| GET, HEAD | `/ready` | 200 when a verified model is loaded and internal authentication is configured, otherwise 503 |
| GET | `/models` | list of `model_versions` rows + `active_version` + latest drift report |
| POST | `/drift/check` | compute PSI on last N (default 1000) scored rows vs training reference; store in `drift_reports`; return report |
| POST | `/retrain` | train candidate; evaluate on holdout; status `VALIDATED` if PR-AUC >= 0.95 x active PR-AUC else `REJECTED`; return `{version, status, metrics}` |
| POST | `/models/{version}/activate` | only if status VALIDATED (or ACTIVE/RETIRED rollback); hot-reload; previous becomes RETIRED |

Model artifacts live in `ml-service/model_store/<version>/` (git-ignored): `xgb_model.json`, `iforest.joblib`, `meta.json`, `reference_stats.json`.
Each artifact set has a SHA-256 stored in `model_versions.sha256` and verified at load time (refuse to load on mismatch).

---

## 7. Decision logic (FR-08), thresholds by DS

`shared/thresholds.json`: `{ "high": 0.80, "low": 0.40, "notes": "placeholder until Riya tunes" }`

```
if p >= high or (p >= low and is_anomaly): HIGH_RISK     -> creates an alert
elif p >= low or is_anomaly:               SUSPICIOUS    -> no alert, visible in transactions
else:                                       LEGITIMATE
```

DS target: HIGH_RISK should be roughly 1-2% of replayed test transactions (the "alert budget"). Report precision/recall at the chosen thresholds.

---

## 8. Backend REST API (all under `/api`, JSON)

Auth: JWT in an **httpOnly cookie** named `fl_token` (SameSite=Lax, Secure when `COOKIE_SECURE=true`), 2 h expiry. Frontend sends requests normally; no token handling in JS.

Error shape for every non-2xx:

```json
{ "error": { "code": "FORBIDDEN", "message": "You do not have access to this resource.", "request_id": "r-1a2b3c" } }
```

Codes: `VALIDATION_ERROR` 400, `UNAUTHENTICATED` 401, `INVALID_CREDENTIALS` 401 (never says whether username exists), `FORBIDDEN` 403, `NOT_FOUND` 404, `CONFLICT` 409, `RATE_LIMITED` 429, `SERVER_ERROR` 500.
Paging: `?page=1&page_size=20` -> `{ "items": [...], "page": 1, "page_size": 20, "total": 134 }`.

| Method | Path | Roles | Body / query | Success response |
|---|---|---|---|---|
| GET | `/health` (no `/api` prefix) | public | | `{"status":"ok"}` |
| GET | `/ready` (no `/api` prefix) | public | | 200 when PostgreSQL, authenticated ML readiness, and any required Kafka connections are available, otherwise 503 |
| POST | `/api/auth/login` | public | `{username,password}` | 200 `{username,role,expires_in}` + cookie |
| POST | `/api/auth/logout` | any | | 204, clears cookie |
| GET | `/api/auth/me` | any | | `{username,role}` |
| GET | `/api/auth/providers` | public | | Google and LinkedIn availability flags |
| GET | `/api/auth/:provider/start` | public | | 303 to the provider or safe error page |
| GET | `/api/auth/:provider/callback` | public browser callback | `state, code, error, iss` | 303 to dashboard or safe error page |
| POST | `/api/auth/:provider/link` | any session, same origin | | 303 to the provider or safe error page |
| POST | `/api/transactions` | ADMIN or header `X-Service-Token` | transaction object (§4 without `ingested_at`) | **202** `{transaction_id,status:"ACCEPTED"}` |
| GET | `/api/transactions` | any | `risk, from, to, q, page, page_size` | paged items (below) |
| GET | `/api/transactions/:id` | any | | item + `top_reasons`, `features`, timestamps, `alert` |
| GET | `/api/alerts` | ADMIN, ANALYST | `state, page, page_size` | paged alerts |
| PATCH | `/api/alerts/:id` | ADMIN, ANALYST | `{state}` or `{state:"RESOLVED",resolution}` | updated alert |
| GET | `/api/dashboard/summary` | any | | summary (below) |
| GET | `/api/dashboard/trends` | any | `minutes=60` | `{points:[{minute,total,flagged}]}` |
| GET | `/api/audit-logs` | ADMIN | `action, username, page` | paged audit rows |
| GET | `/api/users` | ADMIN | | `{items:[{id,username,role,status,created_at}]}` |
| POST | `/api/users` | ADMIN | `{username,password,role}` | 201 user |
| PATCH | `/api/users/:id` | ADMIN | `{role?,status?,password?}` | user |
| GET | `/api/models` | ADMIN | | proxies ml-service `/models` |
| POST | `/api/models/drift-check` | ADMIN | | proxies `/drift/check` |
| POST | `/api/models/retrain` | ADMIN | | **202** proxies `/retrain` |
| POST | `/api/models/:version/activate` | ADMIN | | proxies activate |
| WS | `/ws/alerts` | any logged-in, allowed Origin | | server sends `{"type":"READY"}` after session validation, then pushes `{"type":"NEW_ALERT","alert":{...fraud-alerts message...}}` |

Transaction list item:

```json
{ "transaction_id": "...", "account_masked": "XXXX-2095", "amount": 1850.0, "category": "shopping_net", "merchant": "fraud_Kutch LLC",
  "tx_time": "2026-11-20T03:12:45Z", "risk_category": "HIGH_RISK", "fraud_probability": 0.93, "is_anomaly": true,
  "model_version": "v1", "alert": { "alert_id": 17, "state": "NEW", "resolution": null } }
```
In inline mode a `202` means PostgreSQL accepted the transaction and scoring job or the ID already exists. In Kafka mode it means the broker accepted the message. Readback can return `404` in Kafka mode while work is in transit. A stored unscored row has `risk_category: "PENDING"` and null probability, anomaly flag, and model version.

Dashboard summary:

```json
{ "total_transactions": 5230, "legitimate": 5101, "suspicious": 96, "high_risk": 33, "open_alerts": 12,
  "latency_ms": { "score_p50": 640, "score_p95": 1450, "alert_p95": 1900 },
  "active_model": { "version": "v1", "drift_status": "OK" },
  "system_status": { "backend": "UP", "database": "UP", "kafka": "UP", "ml_service": "UP", "streaming": "UP" },
  "updated_at": "2026-11-20T03:13:00Z" }
```
`streaming` is UP if `service_heartbeats.last_seen` is within 60 s. `ml_service` UP if `GET /health` works. Kafka UP if the producer is connected.

Alert state machine: `NEW -> UNDER_REVIEW -> RESOLVED`, also `NEW -> RESOLVED`. RESOLVED requires `resolution` = `CONFIRMED_FRAUD` or `FALSE_POSITIVE`. Changing a RESOLVED alert -> 409.

---

## 9. Backend internal module contracts (so Riya and Shivansh can work in parallel)

Skeleton ships with STUBS for these (pass-through). Shivansh replaces the implementation, **never the export names/signatures**. Riya imports them.

| File (under `backend/src/`) | Export | Behaviour |
|---|---|---|
| `middleware/authenticate.js` | `(req,res,next)` | verifies cookie JWT, sets `req.user = {id,username,role}`, else 401 |
| `middleware/authorize.js` | `(...roles) => (req,res,next)` | 403 if `req.user.role` not in roles; logs `ACCESS_DENIED` audit |
| `middleware/validate.js` | `(schema) => (req,res,next)` | validates `{body,query,params}` with zod; 400 `VALIDATION_ERROR` |
| `middleware/serviceAuth.js` | `(req,res,next)` | allows valid `X-Service-Token` (constant-time compare) or an ADMIN session |
| `validation/schemas.js` | `createTransaction, alertPatch, listQuery, login, createUser, patchUser` | zod schemas |
| `utils/mask.js` | `maskAccount(ref)`, `maskTransaction(row)` | masking rule §2 (already implemented) |
| `utils/jwt.js` | `signToken(user)`, `verifyRequestCookie(req)` | `verifyRequestCookie` returns user or null; also used for the WebSocket upgrade request |
| `audit/auditLogger.js` | `async audit({req, userId, username, action, entity, entityId, details})` | writes hash-chained row (§3) |

Audit `action` values: `LOGIN_SUCCESS, LOGIN_FAILURE, LOGOUT, USER_CREATED, USER_UPDATED, ALERT_RAISED, ALERT_STATE_CHANGED, MODEL_DRIFT_CHECK, MODEL_RETRAIN, MODEL_ACTIVATED, ACCESS_DENIED`.
`ALERT_RAISED` is written by the backend when it consumes `fraud-alerts` in Kafka mode or when it commits the inline score and alert in inline mode.
Per-transaction decisions are traceable through `fraud_results` (transaction id + model version) and are not duplicated in the audit log.

Route files (Riya): `routes/transactions.routes.js, alerts.routes.js, dashboard.routes.js, models.routes.js`.
Route files (Shivansh): `routes/auth.routes.js, users.routes.js, audit.routes.js`.
`server.js` (Riya) mounts all routers; Shivansh's routers are mounted from day 1 (empty stubs exist).

---

## 10. Latency definitions (for the performance report)

- **Scoring latency** = `fraud_results.scored_at - transactions.ingested_at`  (SRS target: 95% under 2 s)
- **Alert latency** = `alerts.created_at - transactions.ingested_at`  (target 3 s)
- **Dashboard latency** = time from alert creation to toast in the browser (measure manually/with a timestamp in the WS message; target 5 s)
- Load targets: 50 TPS sustained (aim 5-10 min), 100 TPS burst (2 min).

---

## 11. Naming and style rules (short)

- JSON fields `snake_case`. JS variables `camelCase`. Python `snake_case`. SQL `snake_case`.
- Times: ISO-8601 UTC strings everywhere.
- No secrets in code. Read from environment.
- Every folder owner writes a tiny README inside their folder: how to run + how to test.
