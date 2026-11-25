# FraudLens Streaming Pipeline (`streaming`)

Consumes `transactions-raw`, stores the first payload for each transaction ID, and scores it against up to 50 earlier records for that account. It calls `ml-service /predict` with the shared 13 features and classifies validated predictions using `shared/thresholds.json`.

For high-risk transactions, the score, alert, and pending notification commit together. The worker retries publication from `alert_outbox` while processing or idle. It removes a row after Kafka acknowledges it. A failure after the broker acknowledgment can cause redelivery, so the backend deduplicates its audit entry by alert ID.

## How to Run (Docker)

Set `DATABASE_URL` and the same `INTERNAL_ML_TOKEN` used by FastAPI in the worker environment.

```bash
docker compose up --build -d streaming
```

## How to Switch Between PySpark and Python Consumer Fallback
By default, `main_stream.py` starts PySpark Structured Streaming (`local[2]`, 1s micro-batch trigger) and automatically falls back to `consumer_fallback.py` if Java/Spark is unavailable. To force fallback mode explicitly:
```bash
STREAM_ENGINE=fallback python -m streaming.jobs.main_stream
```
