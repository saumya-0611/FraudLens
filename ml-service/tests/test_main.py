"""Unit tests for FraudLens ML Service (Phase 2 & Phase 3: XGBoost + Isolation Forest + Lifecycle)."""
import os
from pathlib import Path
import tempfile

# Use an isolated temporary model_store during unit tests
_TMP_STORE = tempfile.mkdtemp(prefix="fraudlens_test_store_")
os.environ["MODEL_STORE_DIR"] = _TMP_STORE
os.environ["INTERNAL_ML_TOKEN"] = "test_internal_secret"

from app.main import app  # noqa: E402
from app.predictor import predictor  # noqa: E402
from app.registry.model_registry import get_model_store_dir, list_model_versions  # noqa: E402

HEADERS = {"X-Internal-Token": "test_internal_secret"}


def test_health_and_token_security():
    from fastapi.testclient import TestClient

    with TestClient(app) as client:
        res = client.get("/health")
        assert res.status_code == 200
        assert res.json()["status"] == "ok"
        assert res.json()["model_version"] == "v1"

        head_res = client.head("/health")
        assert head_res.status_code == 200

        payload = {"instances": [{"transaction_id": "t1", "features": {"amount": 100.0}}]}
        assert client.post("/predict", json=payload).status_code == 401
        assert client.post("/predict", json=payload, headers={"X-Internal-Token": "wrong"}).status_code == 401


def test_real_predict_and_top_reasons():
    from fastapi.testclient import TestClient

    payload = {
        "instances": [
            {
                "transaction_id": "tx-high-risk",
                "features": {
                    "amount": 3250.0,
                    "log_amount": 8.086,
                    "hour": 2,
                    "day_of_week": 5,
                    "is_night": 1,
                    "category_code": 8,
                    "distance_km": 145.0,
                    "customer_age": 34,
                    "tx_count_1h": 4,
                    "tx_count_24h": 7,
                    "secs_since_last_tx": 25.0,
                    "avg_amount_prior": 45.0,
                    "amount_ratio": 72.2,
                },
            }
        ]
    }
    with TestClient(app) as client:
        res = client.post("/predict", json=payload, headers=HEADERS)
        assert res.status_code == 200
        body = res.json()
        assert body["model_version"] == "v1"
        pred = body["predictions"][0]
        assert pred["transaction_id"] == "tx-high-risk"
        assert 0.0 < pred["fraud_probability"] < 1.0
        assert 0.0 <= pred["anomaly_score"] <= 1.0
        assert isinstance(pred["is_anomaly"], bool)
        assert 1 <= len(pred["top_reasons"]) <= 3
        assert set(pred["top_reasons"][0].keys()) == {"feature", "impact", "text"}


def test_sha256_tamper_detection():
    """Verify that tampering with a model artifact causes load_version to refuse loading (T2.2/T2.3)."""
    predictor.ensure_loaded()
    models = list_model_versions()
    v1_rec = next(m for m in models if m["version"] == "v1")
    meta_file = Path(get_model_store_dir()) / "v1" / "meta.json"
    original_bytes = meta_file.read_bytes()

    try:
        meta_file.write_bytes(original_bytes + b"\n")
        raised = False
        try:
            predictor.load_version("v1", v1_rec["sha256"])
        except RuntimeError as exc:
            assert "SHA-256 integrity check failed" in str(exc)
            raised = True
        assert raised, "Expected RuntimeError on SHA-256 mismatch"
    finally:
        meta_file.write_bytes(original_bytes)


def test_drift_retrain_and_hot_reload_activate():
    """Test Phase 3 endpoints: /drift/check, /retrain, /models/{version}/activate."""
    from fastapi.testclient import TestClient

    with TestClient(app) as client:
        drift_res = client.post("/drift/check", headers=HEADERS)
        assert drift_res.status_code == 200
        assert drift_res.json()["status"] in ("OK", "WARNING", "DRIFT")

        retrain_res = client.post("/retrain", headers=HEADERS)
        assert retrain_res.status_code == 200
        new_ver = retrain_res.json()["version"]
        assert new_ver == "v2"
        assert retrain_res.json()["status"] in ("VALIDATED", "REJECTED")

        if retrain_res.json()["status"] == "VALIDATED":
            act_res = client.post(f"/models/{new_ver}/activate", headers=HEADERS)
            assert act_res.status_code == 200
            assert act_res.json()["active_version"] == "v2"

            # Verify /health and /predict now report v2 without server restart
            assert client.get("/health").json()["model_version"] == "v2"


if __name__ == "__main__":
    test_health_and_token_security()
    test_real_predict_and_top_reasons()
    test_sha256_tamper_detection()
    test_drift_retrain_and_hot_reload_activate()
    print("All Phase 2 & Phase 3 ML service tests PASSED!")
