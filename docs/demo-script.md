# FraudLens 5–7 Minute Live Presentation Demo Script (`docs/demo-script.md`)

**Presentation Date:** Friday, 27 Nov 2026 (Capstone II, Team 34)  
**Target Duration:** 6 minutes + Q&A

---

## Pre-Flight Checklist (10 Minutes Before Presenting)

```bash
# 1. Start the complete Docker Compose stack
cp .env.example .env
docker compose up --build -d

# 2. Confirm all containers are healthy
docker compose ps

# 3. Seed demo users (ADMIN, ANALYST, VIEWER)
docker compose exec backend npm run seed
```
- Open browser to `http://localhost:5173`.
- Keep one terminal open in the repo root ready to run `python simulator/replay.py`.
- Have your backup demo video open in a media player tab in case of Wi-Fi/Docker hiccups.

---

## Step-by-Step Demo Flow (6 Minutes)

### Step 1 — System Health & Architecture Overview (0:00 – 0:45)
- Show the FraudLens Dashboard top status bar: **`backend: UP` | `database: UP` | `kafka: UP` | `ml_service: UP` | `streaming: UP`**.
- Mention the real-time pipeline:
  `Simulator -> Backend (202 Accepted) -> Kafka (transactions-raw) -> PySpark Streaming (50-row lookback + 13 shared features) -> FastAPI ML Service (XGBoost + Isolation Forest) -> PostgreSQL -> Kafka (fraud-alerts) -> WebSocket Toast`.

### Step 2 — Role-Based Access Control & Account Masking (0:45 – 1:30)
- Log in as **ANALYST** (`analyst` / seed password).
- Navigate to **Transactions**: point out that every card/account number is masked as `XXXX-2095` across all APIs and roles (CONTRACTS §2 privacy rule).
- Show that the **Admin / Users / Models / Audit Log** menu items are restricted for `ANALYST` (and `VIEWER` cannot modify alerts).

### Step 3 — Live Streaming Ingestion & Real-Time WebSocket Alert Toast (1:30 – 2:45)
- In the terminal, start the transaction stream at 10 TPS with a 5% fraud boost:
  ```bash
  python simulator/replay.py --tps 10 --limit 60 --fraud-boost 0.05
  ```
- Watch the dashboard KPI counters (`Total Transactions`, `Legitimate`, `Suspicious`, `High Risk`, `Open Alerts`) and the 60-minute trend chart update live.
- Point out the **real-time WebSocket Toast notification** (`NEW_ALERT`) appearing within ~2 seconds when a `HIGH_RISK` transaction is scored.

### Step 4 — Explainable AI: Hybrid Score, Anomaly Flag & Top-3 Reasons (2:45 – 3:45)
- Click on the newly raised `HIGH_RISK` alert to open the investigation drawer/detail view:
  - **Fraud Probability** (from XGBoost) and **Anomaly Score / `is_anomaly` badge** (from Isolation Forest, FR-07).
  - **Top 3 Reasons** computed from XGBoost `pred_contribs`, e.g.:
    1. `"Amount is 38x this account's usual average"` (`amount_ratio`)
    2. `"Late-night transaction at 02:00 UTC (22:00-06:00 window)"` (`is_night`)
    3. `"Merchant is 145.0 km away from customer location"` (`distance_km`)
  - **Model Version**: `v1`.

### Step 5 — Alert Resolution State Machine & Tamper-Evident Audit Chain (3:45 – 4:30)
- Transition the alert from `NEW -> UNDER_REVIEW -> RESOLVED` with resolution **`CONFIRMED_FRAUD`**.
- Log in as **ADMIN** and open **Audit Logs**:
  - Show the `ALERT_RAISED` and `ALERT_STATE_CHANGED` entries with their SHA-256 hash chain (`prev_hash` -> `entry_hash`).

### Step 6 — Concept Drift Detection, Retraining & Zero-Downtime Hot-Reload (4:30 – 5:30)
- In the terminal, replay shifted traffic with `--drift-mode` (3x transaction amounts):
  ```bash
  python simulator/replay.py --tps 15 --limit 80 --drift-mode
  ```
- In the **Admin -> Models** panel:
  1. Click **Run Drift Check** (`POST /api/models/drift-check`) -> PSI > 0.25 -> status changes to **`DRIFT`**.
  2. Click **Retrain Candidate** (`POST /api/models/retrain`) -> trains **`v2`** incorporating resolved alert feedback and validates holdout PR-AUC (>= 95% of active PR-AUC) -> status **`VALIDATED`**.
  3. Click **Activate `v2`** (`POST /api/models/v2/activate`) -> verifies artifact folder SHA-256 and hot-reloads `v2` in memory without restarting FastAPI.
  4. Send a few more transactions and show new predictions now stamped with **`model_version: "v2"`**.

### Step 7 — Performance & Security Proof Reports (5:30 – 6:00)
- Show [docs/test-reports/latency.md](file:///e:/FraudLens/docs/test-reports/latency.md) (Scoring p95 < 2000 ms, Alert p95 < 3000 ms) and [docs/test-reports/model-evaluation.md](file:///e:/FraudLens/docs/test-reports/model-evaluation.md) (PR-AUC headline metric and XGBoost vs. Hybrid comparison).
