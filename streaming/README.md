# FraudLens Streaming Pipeline (`streaming`)

Consumes transactions from Kafka topic `transactions-raw`, computes the 13 features using `shared/fraud_features.py` with a 50-row per-account lookback from PostgreSQL, calls `ml-service /predict`, classifies risk using `shared/thresholds.json`, persists idempotently (`ON CONFLICT DO NOTHING`) to `transactions`, `fraud_results`, and `alerts`, and publishes new high-risk alerts to `fraud-alerts`.

## How to Run (Docker)
```bash
docker compose up --build -d streaming
```

## How to Switch Between PySpark and Python Consumer Fallback
By default, `main_stream.py` starts PySpark Structured Streaming (`local[2]`, 1s micro-batch trigger) and automatically falls back to `consumer_fallback.py` if Java/Spark is unavailable. To force fallback mode explicitly:
```bash
STREAM_ENGINE=fallback python -m streaming.jobs.main_stream
```
