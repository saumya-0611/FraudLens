"""Liveness and model-readiness behavior with isolated predictor state."""
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app import main


def test_readiness_requires_artifact_and_internal_credential(monkeypatch):
    monkeypatch.setattr(main, "predictor", SimpleNamespace(version="v1", is_loaded=False))
    monkeypatch.setenv("INTERNAL_ML_TOKEN", "test-readiness-fixture-token")
    # Build TestClient without starting the application lifespan or training a model.
    client = TestClient(main.app)
    assert client.get("/health").status_code == 200
    assert client.get("/ready").status_code == 503
    assert client.get("/ready").json() == {"status": "unavailable"}

    monkeypatch.setattr(main.predictor, "is_loaded", True)
    assert client.get("/ready").json() == {"status": "ok"}
    assert client.head("/ready").status_code == 200
    assert client.head("/ready", headers={"X-Internal-Token": "test-readiness-fixture-token"}).status_code == 200
    assert client.head("/ready", headers={"X-Internal-Token": "wrong"}).status_code == 401

    monkeypatch.delenv("INTERNAL_ML_TOKEN")
    assert client.get("/ready").status_code == 503
