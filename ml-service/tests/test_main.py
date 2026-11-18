"""Unit tests for FraudLens ML Service stub (T0.4)."""
import os

from fastapi.testclient import TestClient

os.environ["INTERNAL_ML_TOKEN"] = "test_internal_secret"

from app.main import app  # noqa: E402

client = TestClient(app)
HEADERS = {"X-Internal-Token": "test_internal_secret"}


def test_health_get_and_head():
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert "model_version" in body

    head_res = client.head("/health")
    assert head_res.status_code == 200


def test_predict_requires_internal_token():
    payload = {"instances": [{"transaction_id": "t1", "features": {"amount": 100.0}}]}
    res_no_token = client.post("/predict", json=payload)
    assert res_no_token.status_code == 401

    res_wrong_token = client.post("/predict", json=payload, headers={"X-Internal-Token": "wrong"})
    assert res_wrong_token.status_code == 401


def test_predict_contract_shape():
    payload = {
        "instances": [
            {
                "transaction_id": "t1",
                "features": {
                    "amount": 1850.0,
                    "log_amount": 7.52,
                    "hour": 3,
                    "day_of_week": 4,
                    "is_night": 1,
                    "category_code": 8,
                    "distance_km": 41.2,
                    "customer_age": 34,
                    "tx_count_1h": 3,
                    "tx_count_24h": 5,
                    "secs_since_last_tx": 40,
                    "avg_amount_prior": 48.3,
                    "amount_ratio": 38.3,
                },
            }
        ]
    }
    res = client.post("/predict", json=payload, headers=HEADERS)
    assert res.status_code == 200
    data = res.json()
    assert data["model_version"] == "v1"
    assert len(data["predictions"]) == 1

    pred = data["predictions"][0]
    assert pred["transaction_id"] == "t1"
    assert 0.0 <= pred["fraud_probability"] <= 1.0
    assert 0.0 <= pred["anomaly_score"] <= 1.0
    assert isinstance(pred["is_anomaly"], bool)
    assert len(pred["top_reasons"]) >= 1
    assert set(pred["top_reasons"][0].keys()) == {"feature", "impact", "text"}


def test_models_lifecycle_endpoints():
    models_res = client.get("/models", headers=HEADERS)
    assert models_res.status_code == 200
    assert "active_version" in models_res.json()

    drift_res = client.post("/drift/check", headers=HEADERS)
    assert drift_res.status_code == 200
    assert drift_res.json()["status"] in ("OK", "WARNING", "DRIFT")

    retrain_res = client.post("/retrain", headers=HEADERS)
    assert retrain_res.status_code == 200
    new_ver = retrain_res.json()["version"]

    act_res = client.post(f"/models/{new_ver}/activate", headers=HEADERS)
    assert act_res.status_code == 200
    assert act_res.json()["active_version"] == new_ver
