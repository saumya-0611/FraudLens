"""
predictor.py - Hybrid XGBoost + Isolation Forest inference engine with SHA-256 verification
and top-3 SHAP/pred_contribs explanations (T2.2, T2.3, T3.3).
"""
import importlib
import json
import threading
from typing import Any, Dict, List

import joblib
import numpy as np
import pandas as pd

from app.registry.model_registry import (
    get_active_model_record,
    get_model_store_dir,
    verify_artifact_sha256,
)
from shared.fraud_features import FEATURE_COLUMNS
from training.train import train_and_register


def format_reason_text(feature: str, feats: Dict[str, float]) -> str:
    """Human-readable explanation template for each of the 13 features (CONTRACTS §6, T2.2)."""
    val = float(feats.get(feature, 0.0))
    amount = float(feats.get("amount", 0.0))
    ratio = max(1.0, float(feats.get("amount_ratio", 1.0)))
    hour = int(feats.get("hour", 0))
    dist = float(feats.get("distance_km", 0.0))
    c1h = int(feats.get("tx_count_1h", 0))
    c24h = int(feats.get("tx_count_24h", 0))
    secs = float(feats.get("secs_since_last_tx", 0.0))
    avg_prior = float(feats.get("avg_amount_prior", 0.0))

    templates = {
        "amount_ratio": f"Amount is {ratio:.0f}x this account's usual average",
        "amount": f"High transaction amount (${amount:.2f})",
        "log_amount": f"Elevated log-scale transaction amount (${amount:.2f})",
        "is_night": f"Late-night transaction at {hour:02d}:00 UTC (22:00-06:00 window)",
        "hour": f"Unusual transaction hour ({hour:02d}:00 UTC)",
        "distance_km": f"Merchant is {dist:.1f} km away from customer location",
        "tx_count_1h": f"High 1-hour velocity ({c1h} prior transactions in last 60 min)",
        "tx_count_24h": f"Elevated 24-hour velocity ({c24h} prior transactions in last 24h)",
        "secs_since_last_tx": f"Rapid repeat transaction ({secs:.0f}s since previous charge)",
        "avg_amount_prior": f"Sharp deviation from account's prior average (${avg_prior:.2f})",
        "category_code": f"High-risk merchant category (code {int(val)})",
        "day_of_week": f"Atypical day-of-week activity (day {int(val)})",
        "customer_age": f"Atypical transaction pattern for age group ({int(val)} yrs)",
    }
    return templates.get(feature, f"Elevated contribution from {feature} ({val:.2f})")


class HybridPredictor:
    """Thread-safe hybrid XGBoost + Isolation Forest predictor supporting hot-reload (T3.3)."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self.version: str = "v1"
        self.sha256: str = ""
        self.engine_type: str = "xgboost"
        self._booster: Any = None
        self._sklearn_clf: Any = None
        self._iforest_bundle: Dict[str, Any] = {}
        self._meta: Dict[str, Any] = {}
        self._reference_stats: Dict[str, Any] = {}

    def ensure_loaded(self) -> None:
        """Load the ACTIVE model from model_store (or bootstrap v1 if none exists yet)."""
        with self._lock:
            if self._booster is not None or self._sklearn_clf is not None:
                return
            active = get_active_model_record()
            if active is None or not (get_model_store_dir() / active["version"] / "meta.json").exists():
                active = train_and_register(version="v1", status_on_save="ACTIVE")
            try:
                self.load_version(active["version"], active["sha256"])
            except FileNotFoundError:
                active = train_and_register(version="v1", status_on_save="ACTIVE")
                self.load_version(active["version"], active["sha256"])

    def load_version(self, version: str, expected_sha256: str) -> None:
        """
        Verify artifact folder SHA-256 against expected_sha256 and load XGBoost + Isolation Forest
        into memory. Refuses to load on SHA-256 mismatch (CONTRACTS §6, T2.2, T2.3).
        """
        version_dir = get_model_store_dir() / version
        verify_artifact_sha256(version_dir, expected_sha256)

        meta = json.loads((version_dir / "meta.json").read_text(encoding="utf-8"))
        ref_stats = json.loads((version_dir / "reference_stats.json").read_text(encoding="utf-8"))
        iforest_bundle = joblib.load(version_dir / "iforest.joblib")

        engine_type = meta.get("engine_type", "xgboost")
        booster = None
        sklearn_clf = None

        if engine_type == "xgboost":
            xgb = importlib.import_module("xgboost")
            booster = xgb.Booster()
            booster.load_model(str(version_dir / "xgb_model.json"))
        else:
            sklearn_clf = joblib.load(version_dir / "sklearn_xgb_fallback.joblib")

        with self._lock:
            self.version = version
            self.sha256 = expected_sha256
            self.engine_type = engine_type
            self._booster = booster
            self._sklearn_clf = sklearn_clf
            self._iforest_bundle = iforest_bundle
            self._meta = meta
            self._reference_stats = ref_stats

    def get_reference_stats(self) -> Dict[str, Any]:
        self.ensure_loaded()
        with self._lock:
            return self._reference_stats

    def predict_batch(self, instances: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Score a batch of instances and return probabilities, anomaly scores, and top-3 reasons."""
        self.ensure_loaded()
        if not instances:
            return {"model_version": self.version, "predictions": []}

        rows = []
        tx_ids = []
        raw_feats_list: List[Dict[str, float]] = []

        for item in instances:
            tx_ids.append(str(item["transaction_id"]))
            f_in = item.get("features") or {}
            clean_f = {}
            for col in FEATURE_COLUMNS:
                raw_v = float(f_in.get(col, 0.0))
                clean_f[col] = raw_v if np.isfinite(raw_v) else 0.0
            # Ensure log_amount and amount_ratio have sensible defaults if omitted in minimal tests
            if "amount" in f_in and "log_amount" not in f_in:
                clean_f["log_amount"] = float(np.log1p(max(0.0, clean_f["amount"])))
            if "amount" in f_in and "amount_ratio" not in f_in:
                avg_p = max(1.0, clean_f.get("avg_amount_prior", 50.0) or 50.0)
                clean_f["amount_ratio"] = float(clean_f["amount"] / avg_p)
            raw_feats_list.append(clean_f)
            rows.append([clean_f[c] for c in FEATURE_COLUMNS])

        X_mat = np.nan_to_num(np.asarray(rows, dtype="float64"), nan=0.0, posinf=1e6, neginf=-1e6)
        X_df = pd.DataFrame(X_mat, columns=FEATURE_COLUMNS)

        with self._lock:
            version = self.version
            if self._booster is not None:
                xgb = importlib.import_module("xgboost")
                dmat = xgb.DMatrix(X_df, feature_names=FEATURE_COLUMNS)
                probs = np.asarray(self._booster.predict(dmat), dtype="float64")
                # pred_contribs returns shape (n_rows, n_features + 1); last column is bias
                contribs = np.asarray(self._booster.predict(dmat, pred_contribs=True), dtype="float64")[:, :-1]
            else:
                probs = np.asarray(self._sklearn_clf.predict_proba(X_df)[:, 1], dtype="float64")
                importances = np.asarray(self._sklearn_clf.feature_importances_, dtype="float64")
                means = np.asarray([self._meta.get("feature_means", {}).get(c, 0.0) for c in FEATURE_COLUMNS])
                stds = np.asarray([self._meta.get("feature_stds", {}).get(c, 1.0) for c in FEATURE_COLUMNS])
                z_scores = np.maximum(0.0, (X_mat - means) / np.maximum(stds, 1e-4))
                contribs = z_scores * importances

            iforest = self._iforest_bundle["model"]
            s_min = float(self._iforest_bundle["score_min"])
            s_max = float(self._iforest_bundle["score_max"])
            thresh_raw = float(self._iforest_bundle["threshold_raw"])

            raw_anom = -iforest.score_samples(X_mat)
            norm_anom = np.clip((raw_anom - s_min) / max(s_max - s_min, 1e-4), 0.0, 0.99)
            is_anom_arr = raw_anom >= thresh_raw

        predictions = []
        for idx, tx_id in enumerate(tx_ids):
            row_contribs = contribs[idx]
            feats = raw_feats_list[idx]

            # Take the 3 largest positive contributions (T2.2)
            pos_pairs = [
                (FEATURE_COLUMNS[f_idx], float(row_contribs[f_idx]))
                for f_idx in range(len(FEATURE_COLUMNS))
                if row_contribs[f_idx] > 0
            ]
            pos_pairs.sort(key=lambda p: p[1], reverse=True)
            if not pos_pairs:
                best_idx = int(np.argmax(np.abs(row_contribs)))
                pos_pairs = [(FEATURE_COLUMNS[best_idx], max(0.01, float(abs(row_contribs[best_idx]))))]

            top_reasons = [
                {
                    "feature": feat_name,
                    "impact": round(float(impact_val), 4),
                    "text": format_reason_text(feat_name, feats),
                }
                for feat_name, impact_val in pos_pairs[:3]
            ]

            predictions.append(
                {
                    "transaction_id": tx_id,
                    "fraud_probability": round(float(np.clip(probs[idx], 0.0001, 0.9999)), 4),
                    "anomaly_score": round(float(norm_anom[idx]), 4),
                    "is_anomaly": bool(is_anom_arr[idx]),
                    "top_reasons": top_reasons,
                }
            )

        return {
            "model_version": version,
            "predictions": predictions,
        }


predictor = HybridPredictor()
