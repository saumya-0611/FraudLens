# FraudLens: Real-Time Financial Fraud Detection Platform

**Capstone II — Team 34**  
Real-time hybrid financial fraud detection platform combining **Apache Kafka (KRaft)**, **PySpark Structured Streaming**, **XGBoost + Isolation Forest** with **SHAP (`pred_contribs`) Explainable AI**, **Population Stability Index (PSI) Concept Drift & Zero-Downtime Hot-Reload**, **Zero-Trust RBAC & Tamper-Evident SHA-256 Hash-Chained Audit Trail**, and a **React + Vite + Tailwind Live Analyst Dashboard**.

---

## 1. Architecture & Service Ports

```text
Simulator / API Client (POST /api/transactions, X-Service-Token)
   │
   ▼
Backend API (Node.js 20 + Express, :5000) ──► Swagger UI (/api-docs)
   │  Publishes to Kafka topic `transactions-raw` (3 partitions, key=account_ref)
   ▼
Streaming Engine (PySpark 3.5.3 Structured Streaming, 1s trigger)
   ├─ Fetches 50 prior transactions per account from PostgreSQL 16
   ├─ Computes 13 vectorised features via `shared/fraud_features.py` (zero training/serving skew)
   ├─ Calls Internal FastAPI ML Service (`ml-service:8000/predict`, X-Internal-Token)
   │    └── Hybrid XGBoost + Isolation Forest (SHA-256 artifact verified) + Top-3 SHAP Reasons
   ├─ Classifies LEGITIMATE / SUSPICIOUS / HIGH_RISK via `shared/thresholds.json`
   ├─ Writes idempotently (`ON CONFLICT DO NOTHING`) to `transactions`, `fraud_results`, `alerts`
   └─ Publishes new HIGH_RISK alerts to Kafka `fraud-alerts`
        │
        ▼
Backend Alert Consumer (`backend-alerts`)
   ├─ Writes tamper-evident SHA-256 hash-chained `ALERT_RAISED` row (`pg_advisory_xact_lock(42)`)
   └─ Pushes real-time `NEW_ALERT` message over `/ws/alerts` WebSocket to React Dashboard (:5173)
```

| Service | Tech Stack | Port | Exposure | Owner |
|---|---|---|---|---|
| `frontend` | React + Vite + Tailwind + Recharts | `5173` | Public (Host) | Amrita |
| `backend` | Node.js 20 + Express + KafkaJS + `ws` | `5000` | Public (Host) | Riya + Shivansh |
| `ml-service` | Python 3.11 + FastAPI + XGBoost + Scikit-Learn | `8000` | Internal Docker Net | Team Lead |
| `streaming` | PySpark 3.5.3 Structured Streaming | — | Internal Docker Net | Team Lead |
| `kafka` | Apache Kafka 3.8.0 (KRaft mode, no Zookeeper) | `9092` | Internal Docker Net | Team Lead |
| `postgres` | PostgreSQL 16 (`database/init.sql`) | `5432` | Internal Docker Net | Team Lead |

---

## 2. Quick Start (Docker Compose)

```bash
# 1. Create local .env from template
cp .env.example .env

# 2. For sign-in, set unique SEED_ADMIN_PASSWORD, SEED_ANALYST_PASSWORD and SEED_VIEWER_PASSWORD in .env.

# 3. Build and start all services
docker compose up --build -d

# 4. Verify readiness and explicitly provision the initial accounts
docker compose ps
curl -fsS http://localhost:5000/ready
docker compose exec backend npm run seed
```

- **Frontend Dashboard:** `http://localhost:5173`
- **Backend liveness:** `http://localhost:5000/health`
- **Backend readiness:** `http://localhost:5000/ready`
- **Interactive Swagger UI (OpenAPI 3.0):** `http://localhost:5000/api-docs`

### Initial accounts

The seed command creates missing accounts with bcrypt cost 10. It preserves existing accounts, including role, password, and disabled status. Each new password must be distinct, at least 12 characters, and at most 72 UTF-8 bytes.

| Role | Username | Password variable | Capabilities |
|---|---|---|---|
| **ADMIN** | `admin` | `SEED_ADMIN_PASSWORD` | Full access: Dashboard, Transactions, Alerts, Users, Audit Logs, Model Drift/Retrain/Activate, Ingest |
| **ANALYST** | `analyst` | `SEED_ANALYST_PASSWORD` | Dashboard, Transactions (masked), Alerts investigation & resolution (`CONFIRMED_FRAUD` / `FALSE_POSITIVE`) |
| **VIEWER** | `viewer` | `SEED_VIEWER_PASSWORD` | Read-only Dashboard & Masked Transactions (`XXXX-last4`) |

---

## 3. Live Streaming Replay & MLOps Demo Commands

```bash
# Replay transactions at 10 TPS with 5% fraud boost (triggers real-time WebSocket alert toasts)
python simulator/replay.py --tps 10 --limit 100 --fraud-boost 0.05

# Replay shifted traffic (3x amounts) to trigger PSI Concept Drift (status -> DRIFT)
python simulator/replay.py --tps 15 --limit 100 --drift-mode

# Run 50 TPS sustained / 100 TPS burst load test and update docs/test-reports/latency.md
python simulator/load_test.py --tps 50 --duration 60

# Optional: Seed 200 static sample rows into PostgreSQL without running the streaming simulator
docker compose exec backend node scripts/seed_sample_data.js

# Verify tamper-evident SHA-256 audit log hash chain
docker compose exec backend node scripts/verify_audit_chain.js
```

---

## 4. Testing & Verification Suites

```bash
# 1. Backend Jest Unit & Security Regression Suite (16 test suites)
cd backend && npm test

# 2. ML Service & SHA-256 Artifact Integrity Pytest Suite
docker compose exec ml-service pytest -v tests/

# 3. Shared 13-Feature 50-Row Streaming Parity & PSI Drift Tests
pytest -v shared/tests/ data-science/drift/ streaming/tests/

# 4. Selenium WebDriver Headless Chrome E2E UI Suite
python tests/selenium/test_fraudlens_e2e.py

# 5. Kubernetes Manifest & Zero-Trust NetworkPolicy Verifier
python security/verify-k8s.py
```

---

## 5. DevOps, Security & Evaluation Reports Index

- **Single Source of Truth Contract:** [docs/CONTRACTS.md](file:///e:/FraudLens/docs/CONTRACTS.md)
- **Team Workflow Guide:** [TEAMMATE.md](file:///e:/FraudLens/TEAMMATE.md)
- **6-Minute Live Presentation Demo Script:** [docs/demo-script.md](file:///e:/FraudLens/docs/demo-script.md)
- **End-to-End Latency Report (`p95 = 1473.7 ms < 2000 ms`):** [docs/test-reports/latency.md](file:///e:/FraudLens/docs/test-reports/latency.md)
- **Hybrid Model Evaluation Report (`PR-AUC = 0.9964`):** [docs/test-reports/model-evaluation.md](file:///e:/FraudLens/docs/test-reports/model-evaluation.md)
- **Cyber Security Verification Report & STRIDE Threat Model:** [docs/test-reports/security-report.md](file:///e:/FraudLens/docs/test-reports/security-report.md) | [security/threat-model.md](file:///e:/FraudLens/security/threat-model.md)
- **JIRA Agile Sprint Backlog & CSV Import:** [docs/jira/JIRA_SPRINT_BACKLOG.md](file:///e:/FraudLens/docs/jira/JIRA_SPRINT_BACKLOG.md) | [docs/jira/jira_backlog_import.csv](file:///e:/FraudLens/docs/jira/jira_backlog_import.csv)
- **Jenkins Pre-Flight Gatekeeper (+1000 Offset Ports):** [Jenkinsfile](file:///e:/FraudLens/Jenkinsfile) | [docker-compose.ci.yml](file:///e:/FraudLens/docker-compose.ci.yml)
- **Kubernetes & Zero-Trust NetworkPolicies:** [deploy/k8s/](file:///e:/FraudLens/deploy/k8s/README.md)
- **Nginx HTTPS (TLS 1.2/1.3) Reverse Proxy:** [deploy/nginx/nginx.conf](file:///e:/FraudLens/deploy/nginx/nginx.conf)
- **Swagger OpenAPI 3.0 & Postman Collection:** [docs/swagger/openapi.json](file:///e:/FraudLens/docs/swagger/openapi.json) | [docs/postman/FraudLens.postman_collection.json](file:///e:/FraudLens/docs/postman/FraudLens.postman_collection.json)
- **HMAC-SHA256 Alert WebHooks & Cloud Deployment (Render + Vercel):** [deploy/webhooks/webhook_receiver.py](file:///e:/FraudLens/deploy/webhooks/webhook_receiver.py) | [render.yaml](file:///e:/FraudLens/render.yaml) | [deploy/CLOUD_DEPLOYMENT.md](file:///e:/FraudLens/deploy/CLOUD_DEPLOYMENT.md)
