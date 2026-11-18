"""
consumer_fallback.py - Plain Python Kafka consumer calling process_batch (T1.1 / Spark fallback).

Reads JSON messages from `transactions-raw` in micro-batches (every 1 second or up to 200 messages)
and calls `pipeline.process_batch(pdf, batch_id)`. Also updates the `streaming` heartbeat every 5s
even when idle so the dashboard status indicator stays green.
"""
import json
import os
import time
from typing import Any, Dict, List

from kafka import KafkaConsumer
import pandas as pd

from streaming.jobs.pipeline import process_batch

COLUMNS = [
    "transaction_id", "account_ref", "amount", "tx_time", "category", "merchant",
    "lat", "lon", "merch_lat", "merch_lon", "customer_age", "ingested_at",
]


def run_consumer() -> None:
    brokers = os.getenv("KAFKA_BROKERS", "kafka:9092").split(",")
    consumer = KafkaConsumer(
        "transactions-raw",
        bootstrap_servers=brokers,
        group_id="fraudlens-streaming-group",
        auto_offset_reset="earliest",
        enable_auto_commit=False,
        value_deserializer=lambda b: b.decode("utf-8", errors="replace"),
    )
    print(f"[streaming] Connected to Kafka {brokers}, consuming transactions-raw...")

    batch_id = 0
    while True:
        records_map = consumer.poll(timeout_ms=1000, max_records=200)
        rows: List[Dict[str, Any]] = []
        for _, records in records_map.items():
            for rec in records:
                try:
                    parsed = json.loads(rec.value)
                    if isinstance(parsed, dict):
                        rows.append({c: parsed.get(c) for c in COLUMNS})
                    else:
                        rows.append({"transaction_id": None, "raw": rec.value})
                except Exception:
                    rows.append({"transaction_id": None, "raw": rec.value})

        pdf = pd.DataFrame(rows) if rows else pd.DataFrame(columns=COLUMNS)
        process_batch(pdf, batch_id)
        if rows:
            consumer.commit()
            print(f"[streaming] Processed batch {batch_id} ({len(rows)} messages)")
            batch_id += 1


if __name__ == "__main__":
    run_consumer()
