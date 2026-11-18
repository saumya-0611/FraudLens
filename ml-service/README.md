# FraudLens ML Service (`ml-service`)

Internal FastAPI service (`port 8000`, never exposed directly to end users) implementing `docs/CONTRACTS.md` §6.

## How to Run (Docker)
```bash
docker compose up --build -d ml-service
```

## How to Run (Local Python)
```bash
cd ml-service
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

## How to Test
```bash
cd ml-service
pytest -v
```
