# FraudLens — JIRA Agile Sprint Backlog & Traceability Matrix (`docs/jira/`)

**Project Key:** `FL` (FraudLens — Real-Time Financial Fraud Detection Platform)  
**Team:** Capstone II, Team 34 (`Lead`, `Riya`, `Amrita`, `Shivansh`)  
**Methodology:** Agile Scrum (2 Sprints across the 12-day capstone build)  
**JIRA CSV Import File:** [jira_backlog_import.csv](file:///e:/FraudLens/docs/jira/jira_backlog_import.csv) (ready for `Jira -> Settings -> System -> External System Import -> CSV`)

---

## 1. Epics Overview

| Epic Key | Epic Name | Owner | SRS Mapping | Status |
|---|---|---|---|---|
| `FL-EPIC-1` | Streaming Ingestion, Kafka KRaft & PySpark Pipeline | Team Lead + Riya | FR-03, FR-04, FR-05 | **DONE** |
| `FL-EPIC-2` | Hybrid AI/ML Engine (XGBoost + Isolation Forest + Explainability) | Team Lead + Riya | FR-06, FR-07, FR-08, FR-09 | **DONE** |
| `FL-EPIC-3` | MLOps Lifecycle (PSI Concept Drift, Retraining, SHA-256 Hot-Reload) | Team Lead + Riya | FR-14, FR-15, FR-16, FR-17 | **DONE** |
| `FL-EPIC-4` | Zero-Trust Cyber Security, RBAC & Hash-Chained Audit Trail | Shivansh + Riya | FR-01, FR-02, FR-12, FR-13 | **IN PROGRESS** |
| `FL-EPIC-5` | Real-Time Analyst Dashboard, WebSocket Alerts & DevOps CI/CD | Amrita + Team Lead | FR-10, FR-11, NFR-01..06 | **IN PROGRESS** |

---

## 2. Sprint 1 Backlog (15 Nov – 20 Nov 2026: Foundation, M0 & M1 Walking Skeleton)

| Issue Key | Type | Summary | Assignee | Story Points | Branch / Commit | Status |
|---|---|---|---|---:|---|---|
| `FL-101` | Task | Repository scaffold, `CONTRACTS.md`, and team branch setup (T0.1) | Team Lead | 2 | `main` (`26408c1`) | **DONE** |
| `FL-102` | Story | PostgreSQL 16 schema (`database/init.sql`) for 8 core tables (T0.2) | Team Lead | 3 | `lead/phase0-infra` (`360ca0a`) | **DONE** |
| `FL-103` | Story | Docker Compose orchestration with Kafka KRaft & `kafka-init` topics (T0.3) | Team Lead | 5 | `lead/phase0-infra` (`360ca0a`) | **DONE** |
| `FL-104` | Story | FastAPI `ml-service` skeleton with `X-Internal-Token` constant-time auth (T0.4) | Team Lead | 3 | `lead/phase0-infra` (`360ca0a`) | **DONE** |
| `FL-105` | Story | Node/Express backend skeleton, config, error handler & `/health` (B1) | Riya | 3 | `riya/backend-skeleton` (`7ed1d08`) | **DONE** |
| `FL-106` | Story | Sparkov dataset loader & 13 shared features (`shared/fraud_features.py`) (D1, D3) | Riya | 5 | `riya/features` (`66b3f14`) | **DONE** |
| `FL-107` | Test | 50-row streaming history vs. full history feature parity test (D3) | Riya | 3 | `riya/features` (`66b3f14`) | **DONE** |
| `FL-108` | Story | Streaming micro-batch pipeline (`pipeline.py`, DLQ, 50-row lookback) (T1.1) | Team Lead | 5 | `lead/phase0-infra` (`fff2ba6`) | **DONE** |
| `FL-109` | Story | PySpark Structured Streaming wrapper (`main_stream.py`) & Kafka fallback (T1.2) | Team Lead | 5 | `lead/phase0-infra` (`fff2ba6`) | **DONE** |
| `FL-110` | Story | Transaction stream simulator (`simulator/replay.py`) with `--drift-mode` (T1.3) | Team Lead | 3 | `lead/phase0-infra` (`fff2ba6`) | **DONE** |
| `FL-111` | Story | Backend `POST /api/transactions` 202 Kafka producer ingestion (B2) | Riya | 3 | `riya/backend-ingestion` (`fe13363`) | **DONE** |
| `FL-112` | Story | Backend transactions, alerts state machine & dashboard REST APIs (B3, B4) | Riya | 5 | `riya/backend-ingestion` (`c529152`) | **DONE** |
| `FL-113` | Story | Kafka `fraud-alerts` consumer & `/ws/alerts` WebSocket push server (B5) | Riya | 5 | `riya/backend-ingestion` (`7b53e60`) | **DONE** |
| `FL-114` | Story | JWT HS256 cookie utility & live DB `authenticate`/`authorize` middleware (C1, C2) | Shivansh | 5 | `shivansh/auth` (`f5d6f81`) | **DONE** |
| `FL-115` | Story | React + Vite + Tailwind layout, `/api` & `/ws` proxy, mock API & Login UI (F1–F3) | Amrita | 5 | `amrita/frontend-skeleton` (`298b99a`) | **DONE** |

---

## 3. Sprint 2 Backlog (21 Nov – 27 Nov 2026: Real ML, Lifecycle, Security, UI & DevOps Rubric)

| Issue Key | Type | Summary | Assignee | Story Points | Branch / Deliverable | Status |
|---|---|---|---|---:|---|---|
| `FL-201` | Story | Time-ordered XGBoost + Isolation Forest training & SHA-256 registry (T2.1, T2.3) | Team Lead | 5 | `main` (`064c44f`) | **DONE** |
| `FL-202` | Story | Real `/predict` with SHA-256 verification & top-3 `pred_contribs` reasons (T2.2) | Team Lead | 5 | `main` (`064c44f`) | **DONE** |
| `FL-203` | Story | PSI drift calculation (`psi.py`, `/drift/check`), `/retrain` & hot-reload `/activate` (T3.1–T3.3, D6) | Team Lead | 5 | `main` (`2c420b8`) | **DONE** |
| `FL-204` | Story | Threshold tuning (`thresholds.json`), evaluation report & EDA notebooks (D2, D4, D5) | Team Lead + Riya | 5 | `main` (`e911e8a`) | **DONE** |
| `FL-205` | Story | Backend ML model management proxy routes (`routes/models.routes.js`) & Jest tests (B6, B7) | Riya | 5 | `riya/backend-ingestion` (`ddb46f7`) | **DONE** |
| `FL-206` | Story | Jenkins pre-flight gatekeeper (`Jenkinsfile`), GitHub Actions CI & Ngrok config (T4.2) | Team Lead | 3 | `main` (`2ec0471`) | **DONE** |
| `FL-207` | Story | Async 50/100 TPS load tester (`load_test.py`), latency report & demo script (T3.4, T4.1, T4.4) | Team Lead | 3 | `main` (`aa92e85`) | **DONE** |
| `FL-208` | Story | Kubernetes manifests (`deploy/k8s/`), Nginx HTTPS reverse proxy & Cloud blueprints | Team Lead + Shivansh | 5 | `deploy/k8s/`, `deploy/nginx/`, `render.yaml` | **DONE** |
| `FL-209` | Story | OpenAPI 3.0 Swagger spec, Postman collection, Alert Webhook & Selenium E2E test suite | Team Lead | 5 | `docs/swagger/`, `docs/postman/`, `tests/selenium/` | **DONE** |
| `FL-210` | Story | Auth routes (`/login` lockout, `/logout`, `/me`), `seed.js`, Zod schemas & `serviceAuth` (C3–C5, C7) | Shivansh | 5 | `shivansh/security` | **TO DO** |
| `FL-211` | Story | Advisory-locked SHA-256 hash-chained `auditLogger.js`, verifier, users/audit routes & attack tests (C6, C8–C12) | Shivansh | 5 | `shivansh/security` | **TO DO** |
| `FL-212` | Story | Frontend Dashboard, WebSocket alert toast, Transactions drawer, Alerts modal & Admin pages (F4–F8) | Amrita | 8 | `amrita/dashboard` | **TO DO** |
