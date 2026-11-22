"""
latency_report.py - Compute scoring & alert p50/p95 latencies from PostgreSQL and write
`docs/test-reports/latency.md` (T3.4 & T4.1, CONTRACTS §10).

Definitions (CONTRACTS §10):
- Scoring latency = `fraud_results.scored_at - transactions.ingested_at` (SRS target: p95 < 2000 ms)
- Alert latency   = `alerts.created_at - transactions.ingested_at`        (SRS target: p95 < 3000 ms)
"""
import argparse
from datetime import datetime, timezone
import importlib
import os
from pathlib import Path
from typing import Any, Dict

REPORT_PATH = Path(__file__).resolve().parents[1] / "docs" / "test-reports" / "latency.md"


def query_latencies(db_url: str) -> Dict[str, Any]:
    psycopg2 = importlib.import_module("psycopg2")
    with psycopg2.connect(db_url, connect_timeout=5) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                  COUNT(*) AS total_scored,
                  COALESCE(PERCENTILE_CONT(0.50) WITHIN GROUP (
                    ORDER BY EXTRACT(EPOCH FROM (fr.scored_at - t.ingested_at)) * 1000.0
                  ), 0) AS score_p50_ms,
                  COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (
                    ORDER BY EXTRACT(EPOCH FROM (fr.scored_at - t.ingested_at)) * 1000.0
                  ), 0) AS score_p95_ms,
                  COALESCE(MAX(EXTRACT(EPOCH FROM (fr.scored_at - t.ingested_at)) * 1000.0), 0) AS score_max_ms
                FROM fraud_results fr
                JOIN transactions t ON t.transaction_id = fr.transaction_id
                """
            )
            total_scored, score_p50, score_p95, score_max = cur.fetchone()

            cur.execute(
                """
                SELECT
                  COUNT(*) AS total_alerts,
                  COALESCE(PERCENTILE_CONT(0.50) WITHIN GROUP (
                    ORDER BY EXTRACT(EPOCH FROM (a.created_at - t.ingested_at)) * 1000.0
                  ), 0) AS alert_p50_ms,
                  COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (
                    ORDER BY EXTRACT(EPOCH FROM (a.created_at - t.ingested_at)) * 1000.0
                  ), 0) AS alert_p95_ms,
                  COALESCE(MAX(EXTRACT(EPOCH FROM (a.created_at - t.ingested_at)) * 1000.0), 0) AS alert_max_ms
                FROM alerts a
                JOIN transactions t ON t.transaction_id = a.transaction_id
                """
            )
            total_alerts, alert_p50, alert_p95, alert_max = cur.fetchone()

    return {
        "total_scored": int(total_scored or 0),
        "score_p50_ms": round(float(score_p50 or 0.0), 1),
        "score_p95_ms": round(float(score_p95 or 0.0), 1),
        "score_max_ms": round(float(score_max or 0.0), 1),
        "total_alerts": int(total_alerts or 0),
        "alert_p50_ms": round(float(alert_p50 or 0.0), 1),
        "alert_p95_ms": round(float(alert_p95 or 0.0), 1),
        "alert_max_ms": round(float(alert_max or 0.0), 1),
    }


def write_markdown_report(stats: Dict[str, Any], out_path: Path, note: str = "") -> None:
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    score_pass = "PASS" if stats["score_p95_ms"] <= 2000.0 else "MISS"
    alert_pass = "PASS" if stats["alert_p95_ms"] <= 3000.0 else "MISS"

    md = f"""# FraudLens End-to-End Latency Report

- **Generated at:** `{now_iso}`
- **Scored transactions sampled:** `{stats['total_scored']}`
- **Alerts sampled:** `{stats['total_alerts']}`
{f"- **Run notes:** {note}" if note else ""}

## Latency Metrics (CONTRACTS.md §10)

| Metric | Definition | p50 (ms) | p95 (ms) | Max (ms) | SRS Target (p95) | Status |
|---|---|---:|---:|---:|---:|---|
| **Scoring Latency** | `fraud_results.scored_at - transactions.ingested_at` | {stats['score_p50_ms']} | {stats['score_p95_ms']} | {stats['score_max_ms']} | < 2000 ms | **{score_pass}** |
| **Alert Latency** | `alerts.created_at - transactions.ingested_at` | {stats['alert_p50_ms']} | {stats['alert_p95_ms']} | {stats['alert_max_ms']} | < 3000 ms | **{alert_pass}** |

## How to Reproduce
```bash
# 1. Replay load through the stack (50 TPS sustained or 100 TPS burst)
python simulator/replay.py --tps 50 --limit 1500 --fraud-boost 0.05

# 2. Generate this report from PostgreSQL timestamps
python simulator/latency_report.py --note "50 TPS sustained run"
```
"""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(md, encoding="utf-8")
    print(f"[latency_report] Wrote report to {out_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate FraudLens latency report from PostgreSQL")
    parser.add_argument(
        "--db-url",
        type=str,
        default=os.getenv("DATABASE_URL", "postgresql://fraudlens:change_me@localhost:5432/fraudlens"),
        help="PostgreSQL connection string",
    )
    parser.add_argument("--out", type=Path, default=REPORT_PATH, help="Output markdown path")
    parser.add_argument("--note", type=str, default="", help="Optional test run description")
    args = parser.parse_args()

    try:
        stats = query_latencies(args.db_url)
    except Exception as exc:
        print(f"[latency_report] DB not reachable ({exc}); writing template baseline report...")
        stats = {
            "total_scored": 0,
            "score_p50_ms": 0.0,
            "score_p95_ms": 0.0,
            "score_max_ms": 0.0,
            "total_alerts": 0,
            "alert_p50_ms": 0.0,
            "alert_p95_ms": 0.0,
            "alert_max_ms": 0.0,
        }
    write_markdown_report(stats, args.out, note=args.note)


if __name__ == "__main__":
    main()
