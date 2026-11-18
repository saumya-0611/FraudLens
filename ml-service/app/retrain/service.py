"""
service.py - Candidate model retraining and validation gate (T3.2, CONTRACTS §6).

Trains a new candidate model version (`v2`, `v3`, ...), optionally incorporating resolved
alert feedback from PostgreSQL (`alerts.resolution`), evaluates PR-AUC on the holdout set,
and marks the candidate:
  - `VALIDATED` if candidate PR-AUC >= 0.95 * active model PR-AUC
  - `REJECTED` otherwise
"""
import re
from typing import Any, Dict

from app.registry.model_registry import (
    get_active_model_record,
    list_model_versions,
    register_model_version,
)
from training.train import train_and_register


def _next_version_name() -> str:
    models = list_model_versions()
    max_num = 1
    for m in models:
        match = re.match(r"^v(\d+)$", str(m.get("version", "")))
        if match:
            max_num = max(max_num, int(match.group(1)))
    return f"v{max_num + 1}"


def retrain_candidate() -> Dict[str, Any]:
    """Train a candidate model version and validate its PR-AUC against the active model (T3.2)."""
    active = get_active_model_record()
    active_pr_auc = 0.0
    if active and isinstance(active.get("metrics"), dict):
        active_pr_auc = float(active["metrics"].get("pr_auc", 0.0))

    new_version = _next_version_name()
    seed = 42 + int(new_version.lstrip("v") or 2)

    candidate = train_and_register(
        version=new_version,
        status_on_save="CANDIDATE",
        include_db_feedback=True,
        seed=seed,
    )

    cand_pr_auc = float(candidate["metrics"].get("pr_auc", 0.0))
    threshold_pr_auc = round(0.95 * active_pr_auc, 4)
    final_status = "VALIDATED" if cand_pr_auc >= threshold_pr_auc else "REJECTED"

    updated = register_model_version(
        version=new_version,
        algorithm=candidate["algorithm"],
        metrics={
            **candidate["metrics"],
            "active_baseline_pr_auc": round(active_pr_auc, 4),
            "validation_gate_min_pr_auc": threshold_pr_auc,
        },
        status=final_status,
        artifact_path=candidate["artifact_path"],
        sha256=candidate["sha256"],
    )

    return {
        "version": updated["version"],
        "status": updated["status"],
        "metrics": updated["metrics"],
    }
