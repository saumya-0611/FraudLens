"""
test_pipeline.py - Unit tests for FraudLens streaming batch validation, account masking,
and hybrid risk classification (T1.1, CONTRACTS §2, §4, §7).
"""
import subprocess
import sys
from unittest.mock import MagicMock, Mock

import pandas as pd
import pytest

from streaming.jobs.classify import classify_risk, load_thresholds, mask_account
from streaming.jobs import pipeline
from streaming.jobs.pipeline import _validate_rows

database_dsn = "postgresql://fixture:synthetic-private@127.0.0.1:1/fixture"


def test_mask_account_never_exposes_full_number():
    assert mask_account("2703186189652095") == "XXXX-2095"
    assert mask_account("1234") == "XXXX-1234"


def test_classify_risk_decision_logic():
    high, low = load_thresholds()
    # p >= high -> HIGH_RISK
    assert classify_risk(0.85, False, high, low) == "HIGH_RISK"
    # p >= low and is_anomaly -> HIGH_RISK
    assert classify_risk(0.45, True, high, low) == "HIGH_RISK"
    # p >= low without anomaly -> SUSPICIOUS
    assert classify_risk(0.50, False, high, low) == "SUSPICIOUS"
    # p < low but is_anomaly -> SUSPICIOUS
    assert classify_risk(0.15, True, high, low) == "SUSPICIOUS"
    # p < low and not anomaly -> LEGITIMATE
    assert classify_risk(0.10, False, high, low) == "LEGITIMATE"


def test_validate_rows_splits_valid_and_dlq():
    df = pd.DataFrame(
        [
            {
                "transaction_id": "tx-valid-1",
                "account_ref": "2703186189652095",
                "amount": 125.50,
                "tx_time": "2026-11-20T03:12:45Z",
                "category": "shopping_net",
                "ingested_at": "2026-11-20T03:12:45.412Z",
            },
            {
                "transaction_id": "tx-bad-neg-amount",
                "account_ref": "2703186189652095",
                "amount": -10.0,
                "tx_time": "2026-11-20T03:12:45Z",
                "category": "shopping_net",
                "ingested_at": "2026-11-20T03:12:45.412Z",
            },
            {
                "transaction_id": "tx-missing-category",
                "account_ref": "2703186189652095",
                "amount": 50.0,
                "tx_time": "2026-11-20T03:12:45Z",
                "category": None,
                "ingested_at": "2026-11-20T03:12:45.412Z",
            },
        ]
    )
    valid_df, dlq = _validate_rows(df)
    assert len(valid_df) == 1
    assert valid_df.iloc[0]["transaction_id"] == "tx-valid-1"
    assert len(dlq) == 2
    assert dlq[0]["source"] == "streaming"


def test_missing_streaming_config_stops_before_postgres_or_ml(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("INTERNAL_ML_TOKEN", raising=False)
    connect = Mock(side_effect=AssertionError("database access attempted"))
    post = Mock(side_effect=AssertionError("HTTP access attempted"))
    monkeypatch.setattr(pipeline.psycopg2, "connect", connect)
    monkeypatch.setattr(pipeline.httpx, "post", post)
    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        pipeline.process_batch(None)
    with pytest.raises(RuntimeError, match="INTERNAL_ML_TOKEN"):
        pipeline._call_ml_service([{"transaction_id": "fixture"}])
    connect.assert_not_called()
    post.assert_not_called()


@pytest.mark.parametrize("dsn", ["invalid fixture DSN", "user=fixture password=synthetic-private"])
def test_invalid_database_config_is_redacted_before_connect(monkeypatch, dsn):
    monkeypatch.setenv("DATABASE_URL", dsn)
    monkeypatch.setenv("INTERNAL_ML_TOKEN", "fixture-token")
    connect = Mock(side_effect=AssertionError("database access attempted"))
    monkeypatch.setattr(pipeline.psycopg2, "connect", connect)
    with pytest.raises(RuntimeError, match="DATABASE_URL") as error:
        pipeline.process_batch(None)
    assert dsn not in str(error.value)
    connect.assert_not_called()


@pytest.mark.parametrize("token", ["", " ", "fixture\r\ninvalid"])
def test_invalid_token_blocks_database_startup(monkeypatch, token):
    monkeypatch.setenv("DATABASE_URL", database_dsn)
    monkeypatch.setenv("INTERNAL_ML_TOKEN", token)
    connect = Mock(side_effect=AssertionError("database access attempted"))
    monkeypatch.setattr(pipeline.psycopg2, "connect", connect)
    with pytest.raises(RuntimeError, match="INTERNAL_ML_TOKEN"):
        pipeline.process_batch(None)
    connect.assert_not_called()


def test_configured_postgres_and_ml_values_are_forwarded_unchanged(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", database_dsn)
    monkeypatch.setenv("INTERNAL_ML_TOKEN", "fixture-token")
    monkeypatch.setenv("ML_SERVICE_URL", "http://127.0.0.1:8015/base/")
    db_context = MagicMock()
    connect = Mock(return_value=db_context)
    monkeypatch.setattr(pipeline.psycopg2, "connect", connect)
    pipeline.process_batch(pd.DataFrame())
    connect.assert_called_once_with(database_dsn)
    db_context.__enter__.return_value.commit.assert_called_once()

    prediction = {"transaction_id": "fixture", "fraud_probability": 0.91,
                  "anomaly_score": 0.2, "is_anomaly": False, "top_reasons": []}
    response = Mock()
    response.json.return_value = {"model_version": "fixture-model", "predictions": [prediction]}
    post = Mock(return_value=response)
    monkeypatch.setattr(pipeline.httpx, "post", post)
    instances = [{"transaction_id": "fixture", "features": {}}]
    assert pipeline._call_ml_service(instances) == ("fixture-model", {"fixture": prediction})
    post.assert_called_once_with(
        "http://127.0.0.1:8015/base/predict",
        json={"instances": instances},
        headers={"X-Internal-Token": "fixture-token"},
        timeout=10.0,
    )


def test_ml_errors_retry_without_echoing_connection_details(monkeypatch):
    monkeypatch.setenv("INTERNAL_ML_TOKEN", "fixture-token")
    post = Mock(side_effect=RuntimeError("synthetic-private"))
    monkeypatch.setattr(pipeline.httpx, "post", post)
    monkeypatch.setattr(pipeline.time, "sleep", Mock())
    with pytest.raises(RuntimeError, match="failed after 3 attempts") as error:
        pipeline._call_ml_service([{"transaction_id": "fixture"}])
    assert "synthetic-private" not in str(error.value)
    assert error.value.__suppress_context__
    assert post.call_count == 3


@pytest.mark.parametrize("module", ["main_stream", "consumer_fallback"])
def test_worker_entrypoints_fail_before_starting_when_token_missing(monkeypatch, module):
    monkeypatch.setenv("DATABASE_URL", database_dsn)
    monkeypatch.delenv("INTERNAL_ML_TOKEN", raising=False)
    monkeypatch.setenv("KAFKA_BROKERS", "127.0.0.1:1")
    monkeypatch.setenv("ML_SERVICE_URL", "http://127.0.0.1:1")
    monkeypatch.setenv("STREAM_ENGINE", "fallback")
    result = subprocess.run(
        [sys.executable, "-B", "-m", "streaming.jobs." + module],
        capture_output=True, text=True, timeout=10,
    )
    assert result.returncode == 1
    assert "INTERNAL_ML_TOKEN must be explicitly configured" in result.stderr
    assert "Connected to Kafka" not in result.stdout
    assert "Heartbeat" not in result.stdout
    assert "Spark startup failed" not in result.stdout



@pytest.mark.parametrize("patch", [
    {"model_version": None},
    {"predictions": []},
    {"predictions": [{"transaction_id": "other"}]},
    {"predictions": [{"transaction_id": "fixture", "fraud_probability": 0.9}]},
])
def test_invalid_predictions_fail_instead_of_fabricating_a_score(monkeypatch, patch):
    monkeypatch.setenv("INTERNAL_ML_TOKEN", "fixture-token")
    monkeypatch.setattr(pipeline.time, "sleep", Mock())
    post = Mock(return_value=Mock(**{"json.return_value": {"model_version": "v1", "predictions": [], **patch}}))
    monkeypatch.setattr(pipeline.httpx, "post", post)
    with pytest.raises(RuntimeError, match="failed after 3 attempts"):
        pipeline._call_ml_service([{"transaction_id": "fixture"}])
    assert post.call_count == 3


def test_mixed_versions_across_chunks_fail_the_batch(monkeypatch):
    monkeypatch.setenv("INTERNAL_ML_TOKEN", "fixture-token")
    monkeypatch.setattr(pipeline.time, "sleep", Mock())
    instances = [{"transaction_id": str(i)} for i in range(201)]

    def response(_url, *, json, **_kwargs):
        version = "v1" if len(json["instances"]) == 200 else "v2"
        predictions = [{**item, "fraud_probability": 0.8, "anomaly_score": 0.2,
                        "is_anomaly": False, "top_reasons": []} for item in json["instances"]]
        return Mock(**{"json.return_value": {"model_version": version, "predictions": predictions}})

    post = Mock(side_effect=response)
    monkeypatch.setattr(pipeline.httpx, "post", post)
    with pytest.raises(RuntimeError, match="failed after 3 attempts"):
        pipeline._call_ml_service(instances)
    assert post.call_count == 4


def test_prediction_parser_rejects_duplicate_ids_and_nonfinite_scores():
    prediction = {"transaction_id": "fixture", "fraud_probability": 0.8, "anomaly_score": 0.2,
                  "is_anomaly": False, "top_reasons": []}
    with pytest.raises(ValueError):
        pipeline._parse_predictions({"model_version": "v2", "predictions": [prediction, prediction]}, {"fixture"})
    with pytest.raises(ValueError):
        pipeline._parse_predictions(
            {"model_version": "v2", "predictions": [{**prediction, "anomaly_score": float("nan")}]}, {"fixture"}
        )


if __name__ == "__main__":
    test_mask_account_never_exposes_full_number()
    test_classify_risk_decision_logic()
    test_validate_rows_splits_valid_and_dlq()
    print("All streaming pipeline unit tests PASSED!")
