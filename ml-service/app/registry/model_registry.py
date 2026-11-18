"""
model_registry.py - Model artifact hashing, SHA-256 verification, and PostgreSQL registry (T2.1, T2.2, T3.3).

Every model version lives in `ml-service/model_store/<version>/` containing:
  - xgb_model.json
  - iforest.joblib
  - meta.json
  - reference_stats.json

A deterministic SHA-256 is computed across those artifact files and stored in `model_versions.sha256`.
At load time (startup or hot-reload activation), `verify_artifact_sha256` recomputes the digest and
refuses to load if any file was tampered with or corrupted (mitigating pickled joblib risks).
"""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

import psycopg2
from psycopg2.extras import RealDictCursor

ARTIFACT_FILES = ("xgb_model.json", "iforest.joblib", "meta.json", "reference_stats.json")


def get_model_store_dir() -> Path:
    default_dir = Path(__file__).resolve().parents[2] / "model_store"
    p = Path(os.getenv("MODEL_STORE_DIR", str(default_dir)))
    p.mkdir(parents=True, exist_ok=True)
    return p


def compute_artifact_sha256(version_dir: Path) -> str:
    """Compute a deterministic SHA-256 hex digest over all artifact files in version_dir."""
    hasher = hashlib.sha256()
    for fname in ARTIFACT_FILES:
        fpath = version_dir / fname
        if not fpath.exists():
            raise FileNotFoundError(f"Missing required model artifact: {fpath}")
        hasher.update(fname.encode("utf-8"))
        hasher.update(b"\x00")
        hasher.update(fpath.read_bytes())
        hasher.update(b"\x00")
    return hasher.hexdigest()


def verify_artifact_sha256(version_dir: Path, expected_sha256: str) -> None:
    """Verify folder SHA-256 before loading model artifacts; raise RuntimeError on mismatch."""
    actual = compute_artifact_sha256(version_dir)
    if actual != expected_sha256:
        raise RuntimeError(
            f"SHA-256 integrity check failed for {version_dir.name}: "
            f"expected {expected_sha256}, got {actual}. Refusing to load model."
        )


def _local_registry_path() -> Path:
    return get_model_store_dir() / "registry.json"


def _read_local_registry() -> Dict[str, Any]:
    path = _local_registry_path()
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"models": [], "drift_reports": []}


def _write_local_registry(data: Dict[str, Any]) -> None:
    path = _local_registry_path()
    path.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")


def _get_db_conn():
    db_url = os.getenv("DATABASE_URL")
    if not db_url:
        return None
    try:
        return psycopg2.connect(db_url, connect_timeout=2)
    except Exception:
        return None


def register_model_version(
    version: str,
    algorithm: str,
    metrics: Dict[str, Any],
    status: str,
    artifact_path: str,
    sha256: str,
) -> Dict[str, Any]:
    """Insert or update a model version in PostgreSQL `model_versions` (and local mirror)."""
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    activated_at = now_iso if status == "ACTIVE" else None

    record = {
        "version": version,
        "algorithm": algorithm,
        "metrics": metrics,
        "status": status,
        "artifact_path": artifact_path,
        "sha256": sha256,
        "created_at": now_iso,
        "activated_at": activated_at,
    }

    # Update local mirror first
    reg = _read_local_registry()
    models = [m for m in reg.get("models", []) if m["version"] != version]
    if status == "ACTIVE":
        for m in models:
            if m["status"] == "ACTIVE":
                m["status"] = "RETIRED"
    models.append(record)
    reg["models"] = models
    _write_local_registry(reg)

    conn = _get_db_conn()
    if conn is not None:
        try:
            with conn:
                with conn.cursor() as cur:
                    if status == "ACTIVE":
                        cur.execute(
                            "UPDATE model_versions SET status = 'RETIRED' WHERE status = 'ACTIVE' AND version <> %s",
                            (version,),
                        )
                    cur.execute(
                        """
                        INSERT INTO model_versions (
                          version, algorithm, metrics, status, artifact_path, sha256, created_at, activated_at
                        ) VALUES (%s, %s, %s::jsonb, %s, %s, %s, %s, %s)
                        ON CONFLICT (version) DO UPDATE SET
                          algorithm = EXCLUDED.algorithm,
                          metrics = EXCLUDED.metrics,
                          status = EXCLUDED.status,
                          artifact_path = EXCLUDED.artifact_path,
                          sha256 = EXCLUDED.sha256,
                          activated_at = COALESCE(EXCLUDED.activated_at, model_versions.activated_at)
                        """,
                        (
                            version,
                            algorithm,
                            json.dumps(metrics),
                            status,
                            artifact_path,
                            sha256,
                            now_iso,
                            activated_at,
                        ),
                    )
        finally:
            conn.close()

    return record


def list_model_versions() -> List[Dict[str, Any]]:
    """Return all model_versions rows ordered by created_at ASC."""
    conn = _get_db_conn()
    if conn is not None:
        try:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT version, algorithm, metrics, status, artifact_path, sha256,
                           created_at, activated_at
                    FROM model_versions
                    ORDER BY created_at ASC, version ASC
                    """
                )
                rows = [dict(r) for r in cur.fetchall()]
                if rows:
                    for r in rows:
                        for ts_col in ("created_at", "activated_at"):
                            if r.get(ts_col) is not None and hasattr(r[ts_col], "strftime"):
                                r[ts_col] = r[ts_col].astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                        if isinstance(r.get("sha256"), str):
                            r["sha256"] = r["sha256"].strip()
                    return rows
        except Exception:
            pass
        finally:
            conn.close()

    return _read_local_registry().get("models", [])


def get_active_model_record() -> Optional[Dict[str, Any]]:
    """Return the currently ACTIVE model record (or None)."""
    models = list_model_versions()
    for m in reversed(models):
        if m.get("status") == "ACTIVE":
            return m
    return None


def set_active_version(version: str) -> Dict[str, Any]:
    """
    Transition `version` to ACTIVE and retire the previous ACTIVE model (T3.3).
    Only VALIDATED, ACTIVE, or RETIRED (for rollback) versions may be activated.
    """
    models = list_model_versions()
    target = next((m for m in models if m["version"] == version), None)
    if target is None:
        raise KeyError(f"Model version '{version}' not found")
    if target["status"] not in ("VALIDATED", "ACTIVE", "RETIRED"):
        raise ValueError(f"Model version '{version}' has status '{target['status']}' and cannot be activated")

    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    # Update local registry mirror
    reg = _read_local_registry()
    for m in reg.get("models", []):
        if m["version"] == version:
            m["status"] = "ACTIVE"
            m["activated_at"] = now_iso
        elif m["status"] == "ACTIVE":
            m["status"] = "RETIRED"
    _write_local_registry(reg)

    conn = _get_db_conn()
    if conn is not None:
        try:
            with conn:
                with conn.cursor() as cur:
                    cur.execute(
                        "UPDATE model_versions SET status = 'RETIRED' WHERE status = 'ACTIVE' AND version <> %s",
                        (version,),
                    )
                    cur.execute(
                        "UPDATE model_versions SET status = 'ACTIVE', activated_at = %s WHERE version = %s",
                        (now_iso, version),
                    )
        finally:
            conn.close()

    target["status"] = "ACTIVE"
    target["activated_at"] = now_iso
    return target
