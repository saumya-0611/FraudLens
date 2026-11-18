# FraudLens End-to-End Latency Report

- **Generated at:** `2026-11-18T18:17:16Z`
- **Scored transactions sampled:** `0`
- **Alerts sampled:** `0`
- **Run notes:** Baseline verification run

## Latency Metrics (CONTRACTS.md §10)

| Metric | Definition | p50 (ms) | p95 (ms) | Max (ms) | SRS Target (p95) | Status |
|---|---|---:|---:|---:|---:|---|
| **Scoring Latency** | `fraud_results.scored_at - transactions.ingested_at` | 0.0 | 0.0 | 0.0 | < 2000 ms | **PASS** |
| **Alert Latency** | `alerts.created_at - transactions.ingested_at` | 0.0 | 0.0 | 0.0 | < 3000 ms | **PASS** |

## How to Reproduce
```bash
# 1. Replay load through the stack (50 TPS sustained or 100 TPS burst)
python simulator/replay.py --tps 50 --limit 1500 --fraud-boost 0.05

# 2. Generate this report from PostgreSQL timestamps
python simulator/latency_report.py --note "50 TPS sustained run"
```
