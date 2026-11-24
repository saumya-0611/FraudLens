"""
main.py - FraudLens ML Service (FastAPI, internal port 8000).

Implements CONTRACTS.md Section 6 (Phase 2 & Phase 3 real ML lifecycle):
- GET & HEAD /health                (public, returns status and active model_version)
- POST /predict                     (XGBoost + Isolation Forest + top_reasons from pred_contribs)
- GET /models                       (list model_versions + active_version + latest drift report)
- POST /drift/check                 (PSI on last N scored rows vs reference_stats.json)
- POST /retrain                     (train candidate, validate PR-AUC >= 0.95 * active PR-AUC)
- POST /models/{version}/activate   (SHA-256 verified hot-reload without restarting FastAPI)
"""
from contextlib import asynccontextmanager
from typing import Any, Dict, List

from fastapi import Depends, FastAPI, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.drift.checker import get_latest_drift_report, run_drift_check
from app.predictor import predictor
from app.registry.model_registry import list_model_versions, set_active_version
from app.retrain.service import retrain_candidate
from app.security import verify_internal_token


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Ensure active model v1 is trained/loaded and SHA-256 verified on startup
    try:
        predictor.ensure_loaded()
    except Exception as exc:
        print(f"[ml-service] Warning during startup model pre-load: {exc}")
    yield


app = FastAPI(
    title="FraudLens ML Service",
    version="1.0.0",
    description="Internal FastAPI service for real-time hybrid fraud scoring, PSI drift detection, and model lifecycle.",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


class PredictInstance(BaseModel):
    transaction_id: str
    features: Dict[str, float] = Field(default_factory=dict)


class PredictRequest(BaseModel):
    instances: List[PredictInstance]


class ReasonItem(BaseModel):
    feature: str
    impact: float
    text: str


class PredictionItem(BaseModel):
    transaction_id: str
    fraud_probability: float
    anomaly_score: float
    is_anomaly: bool
    top_reasons: List[ReasonItem]


class PredictResponse(BaseModel):
    model_version: str
    predictions: List[PredictionItem]


@app.api_route("/health", methods=["GET", "HEAD"])
def health() -> Dict[str, str]:
    """Public lightweight health check (supports GET and HEAD for Docker/Uptime checks)."""
    return {"status": "ok", "model_version": predictor.version}


@app.post("/predict", response_model=PredictResponse, dependencies=[Depends(verify_internal_token)])
def predict(req: PredictRequest) -> Dict[str, Any]:
    """Score a batch of transactions using the active XGBoost + Isolation Forest model (CONTRACTS §6)."""
    raw_instances = [{"transaction_id": item.transaction_id, "features": item.features} for item in req.instances]
    return predictor.predict_batch(raw_instances)


@app.get("/models", dependencies=[Depends(verify_internal_token)])
def list_models() -> Dict[str, Any]:
    """Return all model_versions rows, active_version, and latest drift report (CONTRACTS §6)."""
    predictor.ensure_loaded()
    return {
        "active_version": predictor.version,
        "models": list_model_versions(),
        "latest_drift": get_latest_drift_report(),
    }


@app.post("/drift/check", dependencies=[Depends(verify_internal_token)])
def drift_check(sample_size: int = Query(default=1000, ge=1, le=10000)) -> Dict[str, Any]:
    """Compute PSI on the last N scored rows vs reference_stats.json and store in drift_reports (T3.1)."""
    return run_drift_check(sample_size=sample_size)


@app.post("/retrain", dependencies=[Depends(verify_internal_token)])
def retrain() -> Dict[str, Any]:
    """Train candidate model version and validate PR-AUC >= 0.95 * active PR-AUC (T3.2)."""
    return retrain_candidate()


@app.post("/models/{version}/activate", dependencies=[Depends(verify_internal_token)])
def activate_model(version: str) -> Dict[str, Any]:
    """
    Activate a VALIDATED (or RETIRED rollback) model version and hot-reload in memory
    after verifying artifact SHA-256 (T3.3).
    """
    models = list_model_versions()
    target = next((m for m in models if m["version"] == version), None)
    if target is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Model {version} not found")
    if target["status"] not in ("VALIDATED", "ACTIVE", "RETIRED"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Model {version} has status {target['status']} and cannot be activated",
        )

    try:
        # Verify SHA-256 and load into memory first before flipping DB status
        predictor.load_version(version, target["sha256"])
        updated = set_active_version(version)
    except (RuntimeError, FileNotFoundError) as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    return {
        "active_version": updated["version"],
        "status": updated["status"],
        "activated_at": updated["activated_at"],
    }
