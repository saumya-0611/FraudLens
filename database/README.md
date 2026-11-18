# FraudLens Database (`postgres:16`)

Contains `init.sql` (exact PostgreSQL 16 schema from `docs/CONTRACTS.md` §3).

## How to Run
```bash
docker compose up -d postgres
```

## How to Test
```bash
docker compose exec postgres psql -U fraudlens -d fraudlens -c "\dt"
```
Expected tables: `users`, `transactions`, `fraud_results`, `alerts`, `audit_logs`, `model_versions`, `drift_reports`, `service_heartbeats`.
