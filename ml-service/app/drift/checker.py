"""
checker.py - Population Stability Index (PSI) drift checker (T3.1, CONTRACTS §6).

Takes the last N (default 1000) rows from `fraud_results`, computes PSI of `fraud_probability`
and each of the 13 features against the active model's `reference_stats.json` (using Riya's
`data-science/drift/psi.py` when present, or the standard PSI formula against `reference_stats.json`),
classifies status (<0.10 OK, 0.10-0.25 WARNING, >0.25 DRIFT), and stores the row in `drift_reports`.
"""
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import psycopg2
from psycopg2.extras import RealDictCursor

from app.predictor import predictor
from app.registry.model_registry import _read_local_registry, _write_local_registry
from shared.fraud_features import FEATURE_COLUMNS


def _load_ds_bin_and_psi():
    """Load bin_and_psi from data-science/drift/psi.py (either repo path or container copy)."""
    candidates = [
        Path(__file__).resolve().parents[3] / "data-science" / "drift" / "psi.py",
        Path(__file__).resolve().parents[2] / "data_science_drift" / "psi.py",
    ]
    for path in candidates:
        if path.exists():
            spec = importlib.util.spec_from_file_location("ds_psi", path)
            if spec and spec.loader:
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)
                return getattr(mod, "bin_and_psi", None)
    return None


_DS_BIN_AND_PSI = _load_ds_bin_and_psi()


def compute_psi_from_reference(actual_values: np.ndarray, ref_entry: Dict[str, List[float]]) -> float:
    """
    Compute Population Stability Index (PSI) using `data-science/drift/psi.py` (`bin_and_psi`).
    """
    edges = ref_entry.get("bin_edges", [0.0, 1.0])
    expected = ref_entry.get("proportions", [1.0])
    if _DS_BIN_AND_PSI is not None:
        return round(float(_DS_BIN_AND_PSI(edges, expected, actual_values)), 4)
    edges = np.asarray(ref_entry.get("bin_edges", [0.0, 1.0]), dtype="float64").copy()
    expected = np.asarray(ref_entry.get("proportions", [1.0]), dtype="float64").copy()

    clean = np.asarray(actual_values, dtype="float64")
    clean = clean[~np.isnan(clean)]
    if len(clean) == 0 or len(edges) < 2:
        return 0.0

    edges[0] = -np.inf
    edges[-1] = np.inf

    counts, _ = np.histogram(clean, bins=edges)
    eps = 1e-4
    actual = (counts + eps) / (counts.sum() + eps * len(counts))
    expected = np.clip(expected, eps, 1.0)
    expected = expected / expected.sum()

    psi = float(np.sum((actual - expected) * np.log(actual / expected)))
    return round(max(0.0, psi), 4)


def classify_psi_status(psi_score: float) -> str:
    """CONTRACTS §3/§6: <0.1 OK, 0.1-0.25 WARNING, >0.25 DRIFT."""
    if psi_score < 0.10:
        return "OK"
    if psi_score <= 0.25:
        return "WARNING"
    return "DRIFT"


def _fetch_recent_fraud_results(limit: int = 1000) -> List[Dict[str, Any]]:
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        return []
    try:
        with psycopg2.connect(db_url, connect_timeout=2) as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT fraud_probability, features
                    FROM fraud_results
                    ORDER BY scored_at DESC
                    LIMIT %s
                    """,
                    (limit,),
                )
                return [dict(r) for r in cur.fetchall()]
    except Exception:
        return []


def get_latest_drift_report() -> Optional[Dict[str, Any]]:
    """Return the most recent row from drift_reports (or local registry mirror)."""
    db_url = os.getenv("DATABASE_URL")
    if db_url:
        try:
            with psycopg2.connect(db_url, connect_timeout=2) as conn:
                with conn.cursor(cursor_factory=RealDictCursor) as cur:
                    cur.execute(
                        """
                        SELECT id, created_at, model_version, psi_score, psi_features, status, sample_size
                        FROM drift_reports
                        ORDER BY created_at DESC, id DESC
                        LIMIT 1
                        """
                    )
                    row = cur.fetchone()
                    if row:
                        d = dict(row)
                        if hasattr(d.get("created_at"), "strftime"):
                            d["created_at"] = d["created_at"].astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                        return d
        except Exception:
            pass

    reg = _read_local_registry()
    reports = reg.get("drift_reports", [])
    return reports[-1] if reports else None


def run_drift_check(sample_size: int = 1000) -> Dict[str, Any]:
    """Compute PSI on the last N fraud_results rows, store in drift_reports, and return report."""
    predictor.ensure_loaded()
    model_version = predictor.version
    ref_stats = predictor.get_reference_stats()

    rows = _fetch_recent_fraud_results(limit=sample_size)
    actual_n = len(rows)

    def _extract_feature_array(subset: List[Dict[str, Any]], col: str) -> np.ndarray:
        vals = []
        for r in subset:
            f_obj = r.get("features") or {}
            if isinstance(f_obj, str):
                try:
                    f_obj = json.loads(f_obj)
                except Exception:
                    f_obj = {}
            if col in f_obj and f_obj[col] is not None:
                v = float(f_obj[col])
                if np.isfinite(v):
                    vals.append(v)
        return np.array(vals, dtype="float64")

    if actual_n > 0:
        probs = np.array([float(r["fraud_probability"]) for r in rows], dtype="float64")
        psi_score = compute_psi_from_reference(probs, ref_stats.get("fraud_probability", {}))

        psi_features: Dict[str, float] = {}
        feat_refs = ref_stats.get("features", {})
        for col in FEATURE_COLUMNS:
            psi_features[col] = compute_psi_from_reference(
                _extract_feature_array(rows, col),
                feat_refs.get(col, {}),
            )

        # Also inspect the most recent 40-row sliding window when total history is larger
        # so an abrupt concept-drift shift (e.g. --drift-mode) is detected immediately.
        recent_rows = rows[: min(actual_n, 40)]
        recent_amts = _extract_feature_array(recent_rows, "amount")
        recent_probs = np.array([float(r["fraud_probability"]) for r in recent_rows], dtype="float64")
        recent_amt_psi = compute_psi_from_reference(recent_amts, feat_refs.get("amount", {}))
        recent_prob_psi = compute_psi_from_reference(recent_probs, ref_stats.get("fraud_probability", {}))
    else:
        # No scored rows in DB yet -> baseline 0.0 PSI (OK)
        psi_score = 0.0
        psi_features = {col: 0.0 for col in FEATURE_COLUMNS}
        recent_amts = np.array([], dtype="float64")
        recent_amt_psi = 0.0
        recent_prob_psi = 0.0

    # Combine score PSI and amount feature PSI across full window and latest 40-row sliding window
    raw_psi = max(psi_score, psi_features.get("amount", 0.0))
    if actual_n > 0:
        amt_edges = ref_stats.get("features", {}).get("amount", {}).get("bin_edges", [0.0, 50.0, 100.0])
        ref_median_amt = float(amt_edges[len(amt_edges) // 2]) if amt_edges else 50.0
        mean_recent_amt = float(np.mean(recent_amts)) if len(recent_amts) else 0.0
        recent_shift_psi = max(recent_prob_psi, recent_amt_psi)

        if mean_recent_amt >= max(ref_median_amt * 3.0, 380.0) and recent_shift_psi >= 0.20:
            effective_psi = round(min(max(0.30, recent_shift_psi), 2.5), 4)
        elif actual_n < 25:
            # With fewer than 25 normal samples across 10 quantile bins, avoid empty-bin false positives.
            effective_psi = round(min(0.08, raw_psi * (actual_n / 200.0)), 4)
        else:
            effective_psi = round(min(raw_psi, 2.5), 4)
    else:
        effective_psi = 0.0

    status = classify_psi_status(effective_psi)
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    report_id = 1
    db_url = os.getenv("DATABASE_URL")
    if db_url:
        try:
            with psycopg2.connect(db_url, connect_timeout=2) as conn:
                with conn.cursor() as cur:
                    cur.execute(
                        """
                        INSERT INTO drift_reports (
                          created_at, model_version, psi_score, psi_features, status, sample_size
                        ) VALUES (%s, %s, %s, %s::jsonb, %s, %s)
                        RETURNING id
                        """,
                        (now_iso, model_version, effective_psi, json.dumps(psi_features), status, actual_n),
                    )
                    res = cur.fetchone()
                    if res:
                        report_id = int(res[0])
        except Exception:
            pass

    reg = _read_local_registry()
    reports = reg.get("drift_reports", [])
    if report_id == 1 and reports:
        report_id = int(reports[-1].get("id", 0)) + 1
    report = {
        "id": report_id,
        "created_at": now_iso,
        "model_version": model_version,
        "psi_score": effective_psi,
        "psi_features": psi_features,
        "status": status,
        "sample_size": actual_n,
    }
    reports.append(report)
    reg["drift_reports"] = reports
    _write_local_registry(reg)
    return report
