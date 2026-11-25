"""
pipeline.py - Core batch processing logic for FraudLens streaming (T1.1).

Independent of Spark so it can be called from either:
  - PySpark Structured Streaming foreachBatch (streaming/jobs/main_stream.py)
  - Plain Python Kafka consumer fallback (streaming/jobs/consumer_fallback.py)
  - Unit tests with a pandas DataFrame
"""
from contextlib import closing
from datetime import datetime, timezone
import importlib
import json
import math
import os
from threading import Lock
import time
from typing import Any, Dict, List, Tuple

import httpx
import pandas as pd
import psycopg2
from psycopg2.extensions import parse_dsn

from shared.fraud_features import FEATURE_COLUMNS, build_features
from streaming.jobs.classify import classify_risk, load_thresholds
from streaming.jobs.writer import (
    insert_fraud_results_idempotent,
    insert_high_risk_alerts,
    insert_transactions_idempotent,
    upsert_heartbeat,
)

REQUIRED_FIELDS = ("transaction_id", "account_ref", "amount", "tx_time", "category", "ingested_at")
TRANSACTION_COLUMNS = (
    "transaction_id", "account_ref", "amount", "tx_time", "category", "merchant",
    "lat", "lon", "merch_lat", "merch_lon", "customer_age", "ingested_at",
)

_producer: Any = None
_producer_lock = Lock()


def _required_database_url() -> str:
    value = os.getenv("DATABASE_URL", "").strip()
    if not value:
        raise RuntimeError("DATABASE_URL must be explicitly configured for streaming.")
    try:
        settings = parse_dsn(value)
    except psycopg2.ProgrammingError:
        raise RuntimeError("DATABASE_URL is invalid; configure a PostgreSQL connection string.") from None
    if not (settings.get("host") or settings.get("hostaddr")) or not settings.get("dbname") or not settings.get("user"):
        raise RuntimeError("DATABASE_URL must specify a PostgreSQL host, database and user.")
    return value


def _required_ml_token() -> str:
    token = os.getenv("INTERNAL_ML_TOKEN", "")
    if not token or token != token.strip() or any(not 32 <= ord(char) <= 126 for char in token):
        raise RuntimeError("INTERNAL_ML_TOKEN must be explicitly configured as a valid HTTP header value.")
    return token


def validate_runtime_config() -> str:
    """Check required streaming settings before opening a network connection."""
    database_url = _required_database_url()
    _required_ml_token()
    return database_url


def get_kafka_producer() -> Any:
    """Lazy singleton Kafka producer for fraud-alerts and transactions-dlq."""
    global _producer
    with _producer_lock:
        if _producer is None:
            kafka_mod = importlib.import_module("kafka")
            brokers = os.getenv("KAFKA_BROKERS", "kafka:9092").split(",")
            _producer = kafka_mod.KafkaProducer(
                bootstrap_servers=brokers,
                acks="all",
                max_block_ms=5000,
                value_serializer=lambda value: json.dumps(value).encode("utf-8"),
                key_serializer=lambda key: key.encode("utf-8") if key else None,
            )
        return _producer


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


def _parse_predictions(body: Any, expected_ids: set[str]) -> Tuple[str, Dict[str, Dict[str, Any]]]:
    if not isinstance(body, dict):
        raise ValueError("Invalid ML prediction response.")
    version, predictions = body.get("model_version"), body.get("predictions")
    if not isinstance(version, str) or not version.strip() or len(version) > 30 or not isinstance(predictions, list):
        raise ValueError("Invalid ML version or predictions.")

    parsed = {}
    for item in predictions:
        if not isinstance(item, dict):
            raise ValueError("Invalid ML prediction.")
        tx_id, probability = item.get("transaction_id"), item.get("fraud_probability")
        reasons = item.get("top_reasons")
        if (
            not isinstance(tx_id, str) or tx_id not in expected_ids or tx_id in parsed
            or not _finite_number(probability) or not 0 <= probability <= 1
            or not _finite_number(item.get("anomaly_score")) or not 0 <= item["anomaly_score"] <= 1
            or type(item.get("is_anomaly")) is not bool
            or not isinstance(reasons, list) or not all(
                isinstance(reason, dict) and isinstance(reason.get("feature"), str)
                and isinstance(reason.get("text"), str) and _finite_number(reason.get("impact"))
                for reason in reasons
            )
        ):
            raise ValueError("Invalid ML prediction.")
        parsed[tx_id] = item
    if parsed.keys() != expected_ids:
        raise ValueError("Incomplete ML predictions.")
    return version, parsed


def _finite_number(value: Any) -> bool:
    return type(value) in (float, int) and math.isfinite(value)


def _call_ml_service(instances: List[Dict[str, Any]]) -> Tuple[str, Dict[str, Dict[str, Any]]]:
    """
    POST chunks of up to 200 rows to ml-service /predict with 3 retries and exponential backoff (T1.1 step 4).
    Raises on persistent failure so the batch is not committed and will be retried.
    """
    ml_url = os.getenv("ML_SERVICE_URL", "http://ml-service:8000").rstrip("/") + "/predict"
    token = _required_ml_token()
    headers = {"X-Internal-Token": token}

    if not instances:
        raise ValueError("Prediction requires at least one instance.")
    model_version = None
    preds_by_tx: Dict[str, Dict[str, Any]] = {}

    for start in range(0, len(instances), 200):
        chunk = instances[start : start + 200]
        last_err: Exception | None = None
        for attempt in range(1, 4):
            try:
                res = httpx.post(ml_url, json={"instances": chunk}, headers=headers, timeout=10.0)
                res.raise_for_status()
                version, predictions = _parse_predictions(
                    res.json(), {instance["transaction_id"] for instance in chunk}
                )
                if model_version is not None and version != model_version:
                    raise ValueError("ML model changed during a batch.")
                model_version = version
                preds_by_tx.update(predictions)
                last_err = None
                break
            except Exception as exc:
                last_err = exc
                if attempt < 3:
                    time.sleep(0.5 * (2 ** (attempt - 1)))
        if last_err is not None:
            raise RuntimeError("ml-service /predict failed after 3 attempts.") from None

    return model_version, preds_by_tx


def _publish_alert_outbox(conn) -> None:
    # A broker ack followed by a database failure can result in redelivery.
    # Consumers deduplicate these deliveries by alert_id.
    for _ in range(50):
        try:
            with conn, conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT alert_id, transaction_id, payload FROM alert_outbox
                    ORDER BY created_at, alert_id
                    LIMIT 1 FOR UPDATE SKIP LOCKED
                    """
                )
                item = cur.fetchone()
                if item is None:
                    return
                alert_id, transaction_id, payload = item
                get_kafka_producer().send("fraud-alerts", key=transaction_id, value=payload).get(timeout=5)
                cur.execute("DELETE FROM alert_outbox WHERE alert_id = %s", (alert_id,))
        except Exception as error:
            print(f"[streaming] Alert publication will retry: {type(error).__name__}")
            return


def _stored_feature_rows(cur, transaction_ids: List[str]) -> pd.DataFrame:
    # Score the authoritative payload, including after a replay with a changed
    # message body. Use the same bounded event-time window as inline scoring.
    cur.execute(
        """
        WITH targets AS (
            SELECT t.* FROM transactions t
            WHERE t.transaction_id = ANY(%s)
              AND NOT EXISTS (
                  SELECT 1 FROM fraud_results f WHERE f.transaction_id = t.transaction_id
              )
        )
        SELECT target.transaction_id AS target_id, target.* FROM targets target
        UNION ALL
        SELECT target.transaction_id AS target_id, history.*
        FROM targets target CROSS JOIN LATERAL (
            SELECT prior.* FROM transactions prior
            WHERE prior.account_ref = target.account_ref
              AND (prior.tx_time, prior.transaction_id COLLATE "C")
                < (target.tx_time, target.transaction_id COLLATE "C")
            ORDER BY prior.tx_time DESC, prior.transaction_id COLLATE "C" DESC
            LIMIT 50
        ) history
        """,
        (transaction_ids,),
    )
    rows = pd.DataFrame(cur.fetchall(), columns=("target_id", *TRANSACTION_COLUMNS))
    if rows.empty:
        return rows

    # Scope each history window to its target before calling the shared builder.
    # Keep the real account reference in the row returned to the writer.
    featured = build_features(rows.assign(account_ref=rows["target_id"]))
    is_target = rows["transaction_id"] == rows["target_id"]
    return featured.loc[is_target].assign(account_ref=rows.loc[is_target, "account_ref"])


def process_batch(pdf: pd.DataFrame, batch_id: int = 0) -> None:
    """Process a micro-batch and retry outstanding publication, even when idle."""
    db_url = validate_runtime_config()

    with closing(psycopg2.connect(db_url, connect_timeout=5)) as conn:
        with conn, conn.cursor() as cur:
            upsert_heartbeat(cur)

        # Publish older committed work even if inference fails for this batch.
        _publish_alert_outbox(conn)
        if pdf is None or pdf.empty:
            return

        valid_df, dlq_messages = _validate_rows(pdf)
        if dlq_messages:
            producer = get_kafka_producer()
            for message in dlq_messages:
                producer.send("transactions-dlq", value=message).get(timeout=5)
        if valid_df.empty:
            return

        valid_df = valid_df.drop_duplicates(subset=["transaction_id"], keep="first")
        transaction_ids = list(valid_df["transaction_id"].astype(str))
        tx_rows = [
            (
                str(r["transaction_id"]), str(r["account_ref"]), float(r["amount"]),
                str(r["tx_time"]), str(r["category"]),
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
        with conn, conn.cursor() as cur:
            insert_transactions_idempotent(cur, tx_rows)
            batch_featured = _stored_feature_rows(cur, transaction_ids)
        if batch_featured.empty:
            return

        instances = [
            {
                "transaction_id": str(row["transaction_id"]),
                "features": {col: float(row[col]) for col in FEATURE_COLUMNS},
            }
            for _, row in batch_featured.iterrows()
        ]
        model_version, predictions = _call_ml_service(instances)
        high, low = load_thresholds()
        score_rows = []
        high_risk_items = []
        for (_, row), instance in zip(batch_featured.iterrows(), instances):
            tx_id = instance["transaction_id"]
            prediction = predictions[tx_id]
            probability = float(prediction["fraud_probability"])
            anomaly = prediction["is_anomaly"]
            reasons = prediction["top_reasons"]
            risk = classify_risk(probability, anomaly, high, low)
            score_rows.append(
                (
                    tx_id, probability, prediction["anomaly_score"], anomaly, risk,
                    json.dumps(reasons), json.dumps(instance["features"]), model_version,
                )
            )
            if risk == "HIGH_RISK":
                high_risk_items.append((row, probability, reasons, model_version))

        with conn, conn.cursor() as cur:
            scored_ids = insert_fraud_results_idempotent(cur, score_rows)
            insert_high_risk_alerts(cur, [item for item in high_risk_items if item[0]["transaction_id"] in scored_ids])
        _publish_alert_outbox(conn)
