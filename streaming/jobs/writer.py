"""
writer.py - Idempotent PostgreSQL batch persistence helpers for FraudLens streaming
(CONTRACTS.md §3, T1.1).

Streaming persists:
  - transactions       (ON CONFLICT DO NOTHING)
  - fraud_results      (ON CONFLICT DO NOTHING)
  - alerts             (ON CONFLICT DO NOTHING RETURNING alert_id, created_at)
  - alert_outbox       (queued in the same transaction as the alert)
  - service_heartbeats (ON CONFLICT DO UPDATE SET last_seen = now())
"""
from datetime import timezone
import json
from typing import Any, Dict, List, Tuple

from psycopg2.extras import execute_values

from streaming.jobs.classify import mask_account


def upsert_heartbeat(cur) -> None:
    """Update service_heartbeats('streaming', now())."""
    cur.execute(
        """
        INSERT INTO service_heartbeats (service, last_seen)
        VALUES ('streaming', now())
        ON CONFLICT (service) DO UPDATE SET last_seen = EXCLUDED.last_seen
        """
    )


def insert_transactions_idempotent(cur, tx_rows: List[Tuple[Any, ...]]) -> None:
    """Idempotently insert raw transaction rows."""
    if not tx_rows:
        return
    execute_values(
        cur,
        """
        INSERT INTO transactions (
          transaction_id, account_ref, amount, tx_time, category, merchant,
          lat, lon, merch_lat, merch_lon, customer_age, ingested_at
        ) VALUES %s
        ON CONFLICT (transaction_id) DO NOTHING
        """,
        tx_rows,
    )


def insert_fraud_results_idempotent(cur, fr_rows: List[Tuple[Any, ...]]) -> set[str]:
    """Return the IDs of score rows inserted by this batch."""
    if not fr_rows:
        return set()
    rows = execute_values(
        cur,
        """
        INSERT INTO fraud_results (
          transaction_id, fraud_probability, anomaly_score, is_anomaly,
          risk_category, top_reasons, features, model_version
        ) VALUES %s
        ON CONFLICT (transaction_id) DO NOTHING
        RETURNING transaction_id
        """,
        fr_rows,
        fetch=True,
    )
    return {transaction_id for (transaction_id,) in rows}


def insert_high_risk_alerts(cur, high_risk_items: List[Tuple[Any, float, List[Dict[str, Any]], str]]) -> None:
    """Persist new alert notifications alongside the alert through the same cursor."""
    for row, prob, top_reasons, m_ver in high_risk_items:
        tx_id = str(row["transaction_id"])
        cur.execute(
            """
            INSERT INTO alerts (transaction_id, risk_score, state)
            VALUES (%s, %s, 'NEW')
            ON CONFLICT (transaction_id) DO NOTHING
            RETURNING alert_id, created_at
            """,
            (tx_id, prob),
        )
        inserted = cur.fetchone()
        if inserted:
            alert_id, created_at = inserted
            created_iso = created_at.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
            payload = {
                "alert_id": int(alert_id),
                "transaction_id": tx_id,
                "account_masked": mask_account(str(row["account_ref"])),
                "amount": float(row["amount"]),
                "category": str(row["category"]),
                "risk_score": round(prob, 4),
                "risk_category": "HIGH_RISK",
                "top_reasons": top_reasons,
                "model_version": m_ver,
                "created_at": created_iso,
            }
            cur.execute(
                "INSERT INTO alert_outbox (alert_id, transaction_id, payload) VALUES (%s, %s, %s::jsonb)",
                (alert_id, tx_id, json.dumps(payload)),
            )
