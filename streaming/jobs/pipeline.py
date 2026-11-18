"""
pipeline.py - Core batch processing logic for FraudLens streaming (T1.1).

Independent of Spark so it can be called from either:
  - PySpark Structured Streaming foreachBatch (streaming/jobs/main_stream.py)
  - Plain Python Kafka consumer fallback (streaming/jobs/consumer_fallback.py)
  - Unit tests with a pandas DataFrame
"""
from datetime import datetime, timezone
import importlib
import json
import os
from pathlib import Path
import time
from typing import Any, Dict, List, Tuple

import httpx
import pandas as pd
import psycopg2
from psycopg2.extras import execute_values

from shared.fraud_features import FEATURE_COLUMNS, build_features

REQUIRED_FIELDS = ("transaction_id", "account_ref", "amount", "tx_time", "category", "ingested_at")
THRESHOLDS_PATH = Path(__file__).resolve().parents[2] / "shared" / "thresholds.json"

_producer: Any = None


def get_kafka_producer() -> Any:
    """Lazy singleton Kafka producer for fraud-alerts and transactions-dlq."""
    global _producer
    if _producer is None:
        kafka_mod = importlib.import_module("kafka")
        brokers = os.getenv("KAFKA_BROKERS", "kafka:9092").split(",")
        _producer = kafka_mod.KafkaProducer(
            bootstrap_servers=brokers,
            value_serializer=lambda v: json.dumps(v).encode("utf-8"),
            key_serializer=lambda k: k.encode("utf-8") if k else None,
        )
    return _producer


def load_thresholds() -> Tuple[float, float]:
    """Read high and low risk thresholds from shared/thresholds.json (CONTRACTS §7)."""
    with open(THRESHOLDS_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)
    return float(data.get("high", 0.80)), float(data.get("low", 0.40))


def classify_risk(prob: float, is_anomaly: bool, high: float, low: float) -> str:
    """Decision logic (FR-08, CONTRACTS §7)."""
    if prob >= high or (prob >= low and is_anomaly):
        return "HIGH_RISK"
    if prob >= low or is_anomaly:
        return "SUSPICIOUS"
    return "LEGITIMATE"


def mask_account(account_ref: str) -> str:
    """Masking rule (CONTRACTS §2): never expose full account_ref in alerts."""
    return "XXXX-" + str(account_ref or "")[-4:]


def _validate_rows(pdf: pd.DataFrame) -> Tuple[pd.DataFrame, List[Dict[str, Any]]]:
    """Split input DataFrame into valid rows and DLQ payloads (T1.1 step 1)."""
    valid_indices: List[int] = []
    dlq_messages: List[Dict[str, Any]] = []
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")

    for idx, row in pdf.iterrows():
        raw_dict = {k: (None if pd.isna(v) else v) for k, v in row.to_dict().items()}
        missing = [f for f in REQUIRED_FIELDS if raw_dict.get(f) in (None, "")]
        if missing:
            dlq_messages.append(
                {
                    "raw": json.dumps(raw_dict, default=str),
                    "error": f"missing required fields: {', '.join(missing)}",
                    "source": "streaming",
                    "failed_at": now_iso,
                }
            )
            continue

        try:
            amt = float(raw_dict["amount"])
            if amt < 0:
                raise ValueError("amount must be >= 0")
            pd.to_datetime(raw_dict["tx_time"], utc=True)
            pd.to_datetime(raw_dict["ingested_at"], utc=True)
        except Exception as exc:
            dlq_messages.append(
                {
                    "raw": json.dumps(raw_dict, default=str),
                    "error": str(exc),
                    "source": "streaming",
                    "failed_at": now_iso,
                }
            )
            continue

        valid_indices.append(idx)

    valid_df = pdf.loc[valid_indices].copy() if valid_indices else pd.DataFrame(columns=pdf.columns)
    return valid_df, dlq_messages


def _call_ml_service(instances: List[Dict[str, Any]]) -> Tuple[str, Dict[str, Dict[str, Any]]]:
    """
    POST chunks of up to 200 rows to ml-service /predict with 3 retries and exponential backoff (T1.1 step 4).
    Raises on persistent failure so the batch is not committed and will be retried.
    """
    ml_url = os.getenv("ML_SERVICE_URL", "http://ml-service:8000").rstrip("/") + "/predict"
    token = os.getenv("INTERNAL_ML_TOKEN", "change_me_internal_token")
    headers = {"X-Internal-Token": token}

    model_version = "v1"
    preds_by_tx: Dict[str, Dict[str, Any]] = {}

    for start in range(0, len(instances), 200):
        chunk = instances[start : start + 200]
        last_err: Exception | None = None
        for attempt in range(1, 4):
            try:
                res = httpx.post(ml_url, json={"instances": chunk}, headers=headers, timeout=10.0)
                res.raise_for_status()
                body = res.json()
                model_version = body.get("model_version", "v1")
                for p in body.get("predictions", []):
                    preds_by_tx[p["transaction_id"]] = p
                last_err = None
                break
            except Exception as exc:
                last_err = exc
                if attempt < 3:
                    time.sleep(0.5 * (2 ** (attempt - 1)))
        if last_err is not None:
            raise RuntimeError(f"ml-service /predict failed after 3 attempts: {last_err}") from last_err

    return model_version, preds_by_tx


def process_batch(pdf: pd.DataFrame, batch_id: int = 0) -> None:
    """Process one micro-batch of transactions end-to-end (T1.1 steps 1-8)."""
    db_url = os.getenv("DATABASE_URL", "postgresql://fraudlens:change_me@postgres:5432/fraudlens")

    with psycopg2.connect(db_url) as conn:
        with conn.cursor() as cur:
            # Always update heartbeat even on empty batches so dashboard knows streaming is alive
            cur.execute(
                """
                INSERT INTO service_heartbeats (service, last_seen)
                VALUES ('streaming', now())
                ON CONFLICT (service) DO UPDATE SET last_seen = EXCLUDED.last_seen
                """
            )
        conn.commit()

        if pdf is None or pdf.empty:
            return

        # Step 1: Validate rows & publish invalid ones to transactions-dlq
        valid_df, dlq_messages = _validate_rows(pdf)
        if dlq_messages:
            producer = get_kafka_producer()
            for msg in dlq_messages:
                producer.send("transactions-dlq", value=msg)
            producer.flush()

        if valid_df.empty:
            return

        # Deduplicate transaction_id within the same batch
        valid_df = valid_df.drop_duplicates(subset=["transaction_id"], keep="first").copy()
        batch_tx_ids = list(valid_df["transaction_id"].astype(str))
        accounts = list(valid_df["account_ref"].astype(str).unique())

        with conn.cursor() as cur:
            # Step 2: INSERT INTO transactions ... ON CONFLICT DO NOTHING
            tx_rows = [
                (
                    str(r["transaction_id"]),
                    str(r["account_ref"]),
                    float(r["amount"]),
                    str(r["tx_time"]),
                    str(r["category"]),
                    None if pd.isna(r.get("merchant")) else str(r.get("merchant")),
                    None if pd.isna(r.get("lat")) else float(r.get("lat")),
                    None if pd.isna(r.get("lon")) else float(r.get("lon")),
                    None if pd.isna(r.get("merch_lat")) else float(r.get("merch_lat")),
                    None if pd.isna(r.get("merch_lon")) else float(r.get("merch_lon")),
                    None if pd.isna(r.get("customer_age")) else int(r.get("customer_age")),
                    str(r["ingested_at"]),
                )
                for _, r in valid_df.iterrows()
            ]
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

            # Step 3: Fetch latest 50 prior transactions per account in batch (excluding current batch)
            cur.execute(
                """
                SELECT transaction_id, account_ref, amount, tx_time, category, merchant,
                       lat, lon, merch_lat, merch_lon, customer_age, ingested_at
                FROM (
                  SELECT t.*,
                         ROW_NUMBER() OVER (PARTITION BY account_ref ORDER BY tx_time DESC) AS rn
                  FROM transactions t
                  WHERE account_ref = ANY(%s)
                    AND NOT (transaction_id = ANY(%s))
                ) ranked
                WHERE rn <= 50
                """,
                (accounts, batch_tx_ids),
            )
            history_cols = [
                "transaction_id", "account_ref", "amount", "tx_time", "category", "merchant",
                "lat", "lon", "merch_lat", "merch_lon", "customer_age", "ingested_at",
            ]
            history_rows = cur.fetchall()
            history_df = pd.DataFrame(history_rows, columns=history_cols) if history_rows else pd.DataFrame(columns=history_cols)

            combined_df = pd.concat([history_df, valid_df[history_cols]], ignore_index=True)
            combined_df["tx_time"] = pd.to_datetime(combined_df["tx_time"], utc=True)
            combined_df = combined_df.sort_values(["tx_time", "transaction_id"]).reset_index(drop=True)

            featured_df = build_features(combined_df)
            batch_featured = featured_df[featured_df["transaction_id"].isin(set(batch_tx_ids))].copy()

            # Step 4: Call ml-service /predict in chunks of 200
            instances = []
            features_by_tx: Dict[str, Dict[str, float]] = {}
            for _, row in batch_featured.iterrows():
                tx_id = str(row["transaction_id"])
                f_dict = {col: float(row[col]) for col in FEATURE_COLUMNS}
                features_by_tx[tx_id] = f_dict
                instances.append({"transaction_id": tx_id, "features": f_dict})

            model_version, preds_by_tx = _call_ml_service(instances)

            # Step 5 & 6: Classify with thresholds.json & insert fraud_results
            high_thresh, low_thresh = load_thresholds()
            fr_rows = []
            high_risk_items = []

            for _, row in batch_featured.iterrows():
                tx_id = str(row["transaction_id"])
                pred = preds_by_tx[tx_id]
                prob = float(pred["fraud_probability"])
                anomaly_score = float(pred.get("anomaly_score", 0.0))
                is_anomaly = bool(pred.get("is_anomaly", False))
                top_reasons = pred.get("top_reasons", [])
                risk_cat = classify_risk(prob, is_anomaly, high_thresh, low_thresh)

                fr_rows.append(
                    (
                        tx_id,
                        prob,
                        anomaly_score,
                        is_anomaly,
                        risk_cat,
                        json.dumps(top_reasons),
                        json.dumps(features_by_tx[tx_id]),
                        model_version,
                    )
                )
                if risk_cat == "HIGH_RISK":
                    high_risk_items.append((row, prob, top_reasons, model_version))

            execute_values(
                cur,
                """
                INSERT INTO fraud_results (
                  transaction_id, fraud_probability, anomaly_score, is_anomaly,
                  risk_category, top_reasons, features, model_version
                ) VALUES %s
                ON CONFLICT (transaction_id) DO NOTHING
                """,
                fr_rows,
            )

            # Step 7: Insert HIGH_RISK alerts and publish to fraud-alerts ONLY if newly inserted
            alerts_to_publish = []
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
                    alerts_to_publish.append(
                        (
                            tx_id,
                            {
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
                            },
                        )
                    )

            # Step 8: Upsert service_heartbeats('streaming', now())
            cur.execute(
                """
                INSERT INTO service_heartbeats (service, last_seen)
                VALUES ('streaming', now())
                ON CONFLICT (service) DO UPDATE SET last_seen = EXCLUDED.last_seen
                """
            )

        conn.commit()

        if alerts_to_publish:
            producer = get_kafka_producer()
            for tx_id, payload in alerts_to_publish:
                producer.send("fraud-alerts", key=tx_id, value=payload)
            producer.flush()
