import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app.registry.model_registry import compute_artifact_sha256, verify_artifact_sha256
from app.security import verify_internal_token


def test_automatic_api_documentation_is_disabled():
    from app.main import app

    client = TestClient(app)
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert client.get(path).status_code == 404


@pytest.mark.parametrize("configured", [None, "", " ", "change_me_internal_token"])
def test_unconfigured_internal_auth_fails_closed(monkeypatch, configured):
    if configured is None:
        monkeypatch.delenv("INTERNAL_ML_TOKEN", raising=False)
    else:
        monkeypatch.setenv("INTERNAL_ML_TOKEN", configured)
    with pytest.raises(HTTPException) as denied:
        verify_internal_token("fixture-token")
    assert denied.value.status_code == 401


def test_only_configured_token_is_accepted(monkeypatch):
    monkeypatch.setenv("INTERNAL_ML_TOKEN", "fixture-internal-token")
    assert verify_internal_token("fixture-internal-token") is None
    with pytest.raises(HTTPException) as denied:
        verify_internal_token("other-fixture-token")
    assert denied.value.status_code == 401


def test_artifact_verification_rejects_inconsistent_fixture(tmp_path):
    for filename in ["xgb_model.json", "iforest.joblib", "meta.json", "reference_stats.json"]:
        (tmp_path / filename).write_bytes(b"synthetic fixture")
    expected = compute_artifact_sha256(tmp_path)
    verify_artifact_sha256(tmp_path, expected)
    (tmp_path / "meta.json").write_bytes(b"alternate synthetic fixture")
    with pytest.raises(RuntimeError, match="Refusing to load model"):
        verify_artifact_sha256(tmp_path, expected)
