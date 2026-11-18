# FraudLens Simulator (`simulator`)

Replays transactions from `data-science/datasets/fraudTest.csv` (or synthetic Sparkov rows if the CSV is absent) to `POST /api/transactions` with `X-Service-Token`.

## How to Run
```bash
# Normal demo replay at 10 TPS with 5% fraud boost
python simulator/replay.py --tps 10 --limit 100 --fraud-boost 0.05

# Drift mode (multiplies amounts by 3x to trigger PSI drift in demo)
python simulator/replay.py --tps 10 --limit 200 --drift-mode
```
