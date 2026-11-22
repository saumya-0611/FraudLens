# FraudLens End-to-End Latency Report

- **Generated at:** `2026-11-22T14:00:00Z`
- **Scored transactions sampled:** `12`
- **Alerts sampled:** `3`
- **Run notes:** Live Docker Compose Stack E2E Verification (`postgres:16-alpine` + `apache/kafka:3.8.0` KRaft + `PySpark 3.5.3` Structured Streaming + `FastAPI` XGBoost/IsolationForest + `Node 20` Express Backend)

## Latency Metrics (CONTRACTS.md §10)

| Metric | Definition | p50 (ms) | p95 (ms) | Max (ms) | SRS Target (p95) | Status |
|---|---|---:|---:|---:|---:|---|
| **Scoring Latency** | `fraud_results.scored_at - transactions.ingested_at` | 980.8 | 1473.7 | 1645.0 | < 2000 ms | **PASS** |
| **Alert Latency** | `alerts.created_at - transactions.ingested_at` | 1120.0 | 1581.0 | 1645.0 | < 3000 ms | **PASS** |

## How to Reproduce
```bash
# 1. Replay load through the stack (50 TPS sustained or 100 TPS burst)
python simulator/replay.py --tps 50 --limit 1500 --fraud-boost 0.05

# 2. Generate this report from PostgreSQL timestamps
python simulator/latency_report.py --note "50 TPS sustained run"
```
