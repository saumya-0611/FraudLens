"""
main.py - FraudLens ML Service (FastAPI, internal port 8000).

Implements CONTRACTS.md Section 6:
- GET & HEAD /health                (public, lightweight health check)
- POST /predict                     (requires X-Internal-Token)
- GET /models                       (requires X-Internal-Token)
- POST /drift/check                 (requires X-Internal-Token)
- POST /retrain                     (requires X-Internal-Token)
- POST /models/{version}/activate   (requires X-Internal-Token)

In Phase 0/1 (M0-M1), /predict serves a deterministic heuristic stub matching the exact
JSON contract so streaming, backend, and frontend can integrate end-to-end immediately.
Phase 2/3 replaces the stub with the trained XGBoost + Isolation Forest predictor.
"""
from datetime import datetime, timezone
from typing import Any, Dict, List

from fastapi import Depends, FastAPI, HTTPException, status
from pydantic import BaseModel, Field

from app.security import verify_internal_token

app = FastAPI(
    title="FraudLens ML Service",
    version="0.1.0",
    description="Internal FastAPI service for real-time fraud scoring, drift detection, and model lifecycle.",
)

# Current active model state (stubbed for M0/M1; backed by PostgreSQL + model_store in Phase 2/3)
_STATE: Dict[str, Any] = {
    "active_version": "v1",
    "models": [
        {
            "version": "v1",
            "algorithm": "xgboost+isolation_forest",
            "metrics": {"pr_auc": 0.87, "precision": 0.84, "recall": 0.81},
            "status": "ACTIVE",
            "artifact_path": "model_store/v1",
            "sha256": "0" * 64,
            "created_at": "2026-11-16T00:00:00Z",
            "activated_at": "2026-11-16T00:00:00Z",
        }
    ],
    "latest_drift": {
        "id": 1,
        "created_at": "2026-11-16T00:00:00Z",
        "model_version": "v1",
        "psi_score": 0.03,
        "psi_features": {"amount": 0.02, "amount_ratio": 0.03},
        "status": "OK",
        "sample_size": 1000,
    },
}


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


def _build_stub_reasons(features: Dict[str, float]) -> List[ReasonItem]:
    """Generate human-readable top_reasons from the 13 input features (CONTRACTS §6)."""
    reasons: List[ReasonItem] = []

    amount_ratio = float(features.get("amount_ratio", 1.0))
    amount = float(features.get("amount", 0.0))
    is_night = int(features.get("is_night", 0))
    distance_km = float(features.get("distance_km", 0.0))
    tx_count_1h = int(features.get("tx_count_1h", 0))

    if amount_ratio >= 3.0:
        reasons.append(
            ReasonItem(
                feature="amount_ratio",
                impact=round(min(0.60, amount_ratio / 100.0 + 0.25), 2),
                text=f"Amount is {amount_ratio:.0f}x this account's usual average",
            )
        )
    if amount >= 500.0 or not reasons:
        reasons.append(
            ReasonItem(
                feature="amount",
                impact=round(min(0.50, amount / 5000.0 + 0.15), 2),
                text=f"High transaction amount (${amount:.2f})",
            )
        )
    if is_night == 1:
        reasons.append(
            ReasonItem(
                feature="is_night",
                impact=0.18,
                text="Transaction occurred during late-night hours (22:00-06:00 UTC)",
            )
        )
    if distance_km >= 50.0:
        reasons.append(
            ReasonItem(
                feature="distance_km",
                impact=0.22,
                text=f"Merchant is {distance_km:.1f} km away from customer location",
            )
        )
    if tx_count_1h >= 3:
        reasons.append(
            ReasonItem(
                feature="tx_count_1h",
                impact=0.20,
                text=f"{tx_count_1h} prior transactions on this account in the last hour",
            )
        )

    # Sort descending by impact and return top 3
    reasons.sort(key=lambda r: r.impact, reverse=True)
    return reasons[:3]


@app.api_route("/health", methods=["GET", "HEAD"])
def health() -> Dict[str, str]:
    """Public lightweight health check (supports GET and HEAD for Docker/Uptime checks)."""
    return {"status": "ok", "model_version": _STATE["active_version"]}


@app.post("/predict", response_model=PredictResponse, dependencies=[Depends(verify_internal_token)])
def predict(req: PredictRequest) -> PredictResponse:
    """
    Score a batch of transactions (CONTRACTS §6).
    Stub logic for M0/M1: fraud_probability = min(0.99, amount / 5000.0).
    """
    predictions: List[PredictionItem] = []
    for item in req.instances:
        feats = item.features or {}
        amount = max(0.0, float(feats.get("amount", 0.0)))
        amount_ratio = max(1.0, float(feats.get("amount_ratio", 1.0)))

        # Stub probability formula per T0.4: min(0.99, amount / 5000)
        prob = round(min(0.99, amount / 5000.0), 4)
        anomaly_score = round(min(0.99, (amount / 6000.0) + (0.15 if amount_ratio > 10 else 0.0)), 4)
        is_anomaly = bool(anomaly_score >= 0.65)

        predictions.append(
            PredictionItem(
                transaction_id=item.transaction_id,
                fraud_probability=prob,
                anomaly_score=anomaly_score,
                is_anomaly=is_anomaly,
                top_reasons=_build_stub_reasons(feats),
            )
        )

    return PredictResponse(
        model_version=_STATE["active_version"],
        predictions=predictions,
    )


@app.get("/models", dependencies=[Depends(verify_internal_token)])
def list_models() -> Dict[str, Any]:
    """List model_versions, active_version, and latest drift report (CONTRACTS §6)."""
    return {
        "active_version": _STATE["active_version"],
        "models": _STATE["models"],
        "latest_drift": _STATE["latest_drift"],
    }


@app.post("/drift/check", dependencies=[Depends(verify_internal_token)])
def drift_check(sample_size: int = 1000) -> Dict[str, Any]:
    """Stub drift check endpoint (replaced with real PSI calculation in Phase 3 T3.1)."""
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    report = {
        "id": (_STATE["latest_drift"]["id"] + 1) if _STATE["latest_drift"] else 1,
        "created_at": now_iso,
        "model_version": _STATE["active_version"],
        "psi_score": 0.04,
        "psi_features": {"amount": 0.03, "amount_ratio": 0.04},
        "status": "OK",
        "sample_size": sample_size,
    }
    _STATE["latest_drift"] = report
    return report


@app.post("/retrain", dependencies=[Depends(verify_internal_token)])
def retrain() -> Dict[str, Any]:
    """Stub retrain endpoint (replaced with real candidate training in Phase 3 T3.2)."""
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    next_num = len(_STATE["models"]) + 1
    new_version = f"v{next_num}"
    candidate = {
        "version": new_version,
        "algorithm": "xgboost+isolation_forest",
        "metrics": {"pr_auc": 0.88, "precision": 0.85, "recall": 0.82},
        "status": "VALIDATED",
        "artifact_path": f"model_store/{new_version}",
        "sha256": "0" * 64,
        "created_at": now_iso,
        "activated_at": None,
    }
    _STATE["models"].append(candidate)
    return {
        "version": new_version,
        "status": candidate["status"],
        "metrics": candidate["metrics"],
    }


@app.post("/models/{version}/activate", dependencies=[Depends(verify_internal_token)])
def activate_model(version: str) -> Dict[str, Any]:
    """Activate a VALIDATED (or RETIRED rollback) model version (CONTRACTS §6)."""
    target = next((m for m in _STATE["models"] if m["version"] == version), None)
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Model {version} not found")
    if target["status"] not in ("VALIDATED", "ACTIVE", "RETIRED"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Model {version} has status {target['status']} and cannot be activated",
        )

    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    for m in _STATE["models"]:
        if m["status"] == "ACTIVE" and m["version"] != version:
            m["status"] = "RETIRED"
    target["status"] = "ACTIVE"
    target["activated_at"] = now_iso
    _STATE["active_version"] = version
    return {"active_version": version, "status": "ACTIVE", "activated_at": now_iso}
